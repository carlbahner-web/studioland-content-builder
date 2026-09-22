/* Handing a finished file to the person using the tool.
 *
 * Three environments, three answers, one call site:
 *
 *  - Served normally on a desktop: a plain `<a download>` works and is what
 *    people expect.
 *  - Served normally on iOS: `<a download>` on a blob is unreliable - Safari
 *    often opens the image in a tab instead of saving it - so the caller falls
 *    back to showing the image to press and hold, which is the gesture that
 *    actually works there.
 *  - Inside a claude.ai artifact viewer: the frame is not allowed to download
 *    at all, and the anchor is silently inert. The viewer grants a `downloads`
 *    capability instead, which asks the person to confirm and then saves.
 *
 * The capability is feature-detected, never assumed: the Netlify build has no
 * `window.claude` and must not care.
 */

declare global {
  interface Window {
    claude?: { use?: (name: string) => Promise<unknown> };
  }
}

type Downloads = {
  save: (req: { filename: string; data: Blob }) => Promise<{ status: string }>;
};

/* Resolved once, lazily. The contract is explicit that a capability never
 * arrives during the first synchronous run and is not ordered against
 * DOMContentLoaded, so nothing may block on it at startup. */
let pending: Promise<Downloads | null> | undefined;

function capability(): Promise<Downloads | null> {
  if (!pending) {
    const use = window.claude?.use;
    pending = use
      ? Promise.resolve(use("downloads")).then((d) => (d as Downloads) ?? null)
      : Promise.resolve(null);
  }
  return pending;
}

/* Whether a generated file can actually be handed over HERE.
 *
 * Worth asking separately from saving, because the two environments that cannot
 * download fail in opposite ways: iOS Safari ignores `download` on a blob and
 * opens the image instead, which the person can at least press and hold; a
 * claude.ai artifact frame makes the anchor silently INERT, so a tool that
 * reports "saved" and did nothing is indistinguishable from a broken one. A
 * caller that can say something truthful up front should.
 *
 * True where the viewer grants the capability; false where there is no
 * capability AND the frame is one that will swallow the anchor.
 */
export async function canSaveFile(): Promise<boolean> {
  if (await capability()) return true;
  try {
    // A top-level page downloads fine. Only a cross-origin frame is the problem,
    // and reading a parent's origin from one throws - which is the test.
    return window.self === window.top || !!window.top?.location.origin;
  } catch {
    return false;
  }
}

export type SaveOutcome =
  /** The viewer confirmed and the file was handed to their save surface. */
  | "saved"
  /** The viewer was asked and said no. Never retry on this. */
  | "declined"
  /** No capability here, so the ordinary browser download was used instead. */
  | "browser";

export async function saveFile(filename: string, blob: Blob): Promise<SaveOutcome> {
  const downloads = await capability();
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return "saved";
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      // "declined" is a person saying no, not a failure to route around.
      if (code === "declined" || code === "rate_limited") return "declined";
      // Anything else (unavailable, a lifecycle code) falls through to the
      // browser path, which is no worse than doing nothing.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "browser";
}
