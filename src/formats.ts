/* Sizes you added yourself.
 *
 * `FORMATS` in brand.ts is a starting guess at what StudioLand actually posts,
 * and the README has always said to change it freely - but changing it means
 * editing a source file, which is not a thing to do mid-design because a client
 * asked for a 4:5 at 1440. So a custom size is a first-class thing the tool can
 * be told about at runtime.
 *
 * They live OUTSIDE the document, in their own key, because a size is a fact
 * about where you post rather than about one asset: adding "LinkedIn banner"
 * once should make it available to every design, including the ones already
 * saved. That is the same reasoning that keeps the artwork folder out of the
 * document.
 *
 * The consequence to be careful about is `hydrate()`. It drops overrides for
 * formats it does not recognise - deliberately, so a dropped format cannot
 * leave a ghost that can never be seen or reset - which means a custom format
 * has to be KNOWN before a design that uses it is hydrated, or its per-format
 * work is silently thrown away. That is why `loadFormats()` is awaited before
 * the draft is read, and why hydrate takes the format list rather than reaching
 * for the constant.
 */
import { FORMATS, type Format } from "./brand.ts";
import { kvGet, kvSet } from "./kv.ts";

const KEY = "custom-formats";

/* Bounds, not preferences. Below about 200px the type autofit has nothing to
 * work with; above 8000 a single MP4 frame is slow enough to look broken and
 * the canvas may exceed what the browser will allocate. */
export const MIN_SIDE = 200;
export const MAX_SIDE = 8000;

/** Custom keys are prefixed so they can never collide with a built-in one. */
const PREFIX = "x-";

export function customKey(): string {
  return `${PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const isCustom = (f: Format): boolean => f.key.startsWith(PREFIX);

const clampSide = (v: number): number =>
  Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, v)));

/** Why a size cannot be added, or null if it can. */
export function formatProblem(label: string, w: number, h: number): string | null {
  if (!label.trim()) return "Give it a name — that is what the list shows.";
  if (!Number.isFinite(w) || !Number.isFinite(h)) return "Width and height have to be numbers.";
  if (w < MIN_SIDE || h < MIN_SIDE) return `Nothing below ${MIN_SIDE}px — the type has nowhere to go.`;
  if (w > MAX_SIDE || h > MAX_SIDE) return `Nothing above ${MAX_SIDE}px — a video frame that size stalls.`;
  return null;
}

/* Defensive for the same reason the design store is: this runs at startup, and
 * a stored size that throws is a tool that will not open. */
function hydrateFormat(raw: unknown): Format | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key : "";
  const label = typeof r.label === "string" ? r.label : "";
  const w = typeof r.w === "number" && Number.isFinite(r.w) ? r.w : 0;
  const h = typeof r.h === "number" && Number.isFinite(r.h) ? r.h : 0;
  if (!key.startsWith(PREFIX) || !label || !w || !h) return null;
  return {
    key,
    label,
    where: typeof r.where === "string" ? r.where : "Custom size",
    w: clampSide(w),
    h: clampSide(h),
  };
}

export async function loadFormats(): Promise<Format[]> {
  const raw = await kvGet<unknown>(KEY).catch(() => undefined);
  if (!Array.isArray(raw)) return [];
  const out: Format[] = [];
  const seen = new Set(FORMATS.map((f) => f.key));
  for (const item of raw) {
    const f = hydrateFormat(item);
    // A duplicate key would make one of the two unreachable - the format list
    // is keyed, and the second entry would never be selectable.
    if (f && !seen.has(f.key)) {
      seen.add(f.key);
      out.push(f);
    }
  }
  return out;
}

export async function saveFormats(formats: Format[]): Promise<void> {
  try {
    await kvSet(KEY, formats.filter(isCustom));
  } catch {
    /* best-effort, like every other write here: losing a size is a nuisance,
       an unhandled rejection while someone is working is worse */
  }
}
