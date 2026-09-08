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
 *
 * The second thing it does is carry the deploy base. Vite rewrites the paths it
 * can SEE - the script tag, the CSS url()s - but these are strings the app hands
 * to an Image at runtime, so nothing rewrites them. On GitHub Pages, where the
 * site lives at /studioland-content-builder/ rather than at the root, a bare
 * "/brand/grain.webp" is a 404 and the failure is silent: the page renders, the
 * fonts fall back, the wordmark never appears. Hence the prefix.
 */
declare global {
  interface Window {
    __SL_INLINE?: Record<string, string>;
  }
}

/* "/" in dev and in the single-file build; "/studioland-content-builder/" on
 * Pages. Vite substitutes this at build time, and build-single.mjs defines it
 * because esbuild has no import.meta in an IIFE.
 *
 * The typeof guard is for the unit tests, which run this file under bare node
 * with no bundler in front of it - there `import.meta.env` is undefined and
 * reading BASE_URL off it throws, taking four whole spec files down with it.
 * It is written as a `typeof` rather than an optional chain so that the exact
 * token both bundlers pattern-match on survives untouched. */
const BASE = (typeof import.meta.env === "undefined" ? "/" : import.meta.env.BASE_URL).replace(
  /\/$/,
  "",
);

export function assetUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return window.__SL_INLINE?.[path] ?? BASE + path;
}
