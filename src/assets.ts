/* Where a brand asset actually lives.
 *
 * Served normally, these are plain paths under public/. In a single-file build
 * there is no server and no public/ - every asset is base64'd into the page and
 * registered on `window.__SL_INLINE`, so this hands back a data URI instead.
 *
 * The indirection is one lookup and it is what lets the whole tool ship as one
 * self-contained HTML file. That is the same trick the arcade in `wild-ride`
 * uses (`games/src/build.py` inlines every asset so each game is one file), so
 * it is a familiar shape here rather than a new idea.
 */
declare global {
  interface Window {
    __SL_INLINE?: Record<string, string>;
  }
}

export function assetUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return window.__SL_INLINE?.[path] ?? path;
}
