/* Build the content builder as ONE self-contained HTML file.
 *
 * Same idea as wild-ride's games/src/build.py: base64 every asset into the page
 * so it runs from anywhere with no server, no public/ directory and no network.
 * Used for a shareable preview (a Claude artifact, a file you can open on a
 * phone) - `npm run build` is still the normal multi-file one.
 *
 * Output is deliberately FRAGMENT-shaped: a <title>, a <style>, the mount point
 * and one <script>, with no <!doctype>/<html>/<head>/<body>. That is the format
 * the artifact host wraps, and a browser opens it happily too.
 *
 * Usage: node scripts/build-single.mjs [outfile]
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import layers from "../src/listing/layers.json" with { type: "json" };

const ROOT = path.resolve(import.meta.dirname, "..");

/* Two one-file builds, because they are for two different errands.
 *
 * The default packs the whole bundle - both tools behind the hash router. The
 * --only=listing build packs the listing builder alone, and is what gets
 * published as a Claude artifact: there is no router there, no way to reach the
 * layer editor, and no reason to make someone download 250kB of it plus every
 * brand asset before a page they opened to change an address can paint. */
const args = process.argv.slice(2);
const LISTING_ONLY = args.includes("--only=listing");
const OUT =
  args.find((a) => !a.startsWith("--")) ??
  path.join(ROOT, "dist-single", LISTING_ONLY ? "listing-builder.html" : "content-builder.html");

const MIME = {
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".png": "image/png",
};

// The listing template's keyed layers. Taken from the manifest rather than
// listed by hand, so adding artwork to assets/listing-src/ and re-running
// `npm run art` cannot leave either build silently one layer short.
const LISTING_ASSETS = [
  "/fonts/TAYWingman.woff2",
  ...Object.keys(layers).map((name) => `/listing/${name}.png`),
];

/** Everything the running app asks for by path, as data URIs. */
const ASSETS = LISTING_ONLY
  ? LISTING_ASSETS
  : [
      "/brand/grain.webp",
      "/brand/studioland-wordmark-cream.png",
      "/brand/studioland-wordmark-charcoal.png",
      "/brand/buzz-wave.webp",
      "/brand/buzz-ride.webp",
      "/fonts/DWFairfield.woff2",
      "/fonts/DWFairfield-Narrow.woff2",
      ...LISTING_ASSETS,
    ];

async function dataUri(publicPath) {
  const file = path.join(ROOT, "public", publicPath.replace(/^\//, ""));
  const buf = await readFile(file);
  const mime = MIME[path.extname(file)] ?? "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const inline = {};
for (const p of ASSETS) inline[p] = await dataUri(p);

/* The artifact viewer wraps this fragment in its own skeleton, which pads the
 * root element by the phone's safe-area insets so a page can run edge to edge.
 * A child sized in vh ignores that padding and overflows by exactly the inset -
 * enough to put a scrollbar on a page that fits. So the one-screen measurements
 * are restated against the element rather than the viewport. */
const ARTIFACT_SHIM = `
html, body { height: 100%; }
.listing { min-height: 100%; }
.listing-panel { max-height: 100dvh; }
.listing-canvas { max-height: calc(100dvh - 140px); }
@media (max-width: 900px) {
  .listing-panel { max-height: none; }
  .listing-canvas { max-height: none; }
}
`;

// The panel's own webfont is referenced from CSS, so swap that URL too.
let css = [
  await readFile(path.join(ROOT, "src/studio.css"), "utf8"),
  await readFile(path.join(ROOT, "src/listing/listing.css"), "utf8"),
  LISTING_ONLY ? ARTIFACT_SHIM : "",
].join("\n");
css = css.replace(/url\("(\/fonts\/[^"]+)"\)/g, (_, p) => `url("${inline[p]}")`);

/* esbuild rather than Vite: one IIFE, no module graph, no import.meta - which
 * this app deliberately does not use, so nothing has to be stubbed. */
const bundled = await build({
  entryPoints: [path.join(ROOT, LISTING_ONLY ? "src/listing/main.tsx" : "src/main.tsx")],
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  target: ["es2022"],
  write: false,
  loader: { ".css": "empty", ".json": "json" }, // the CSS is inlined above, not imported
  // One file means one script, so the listing builder's lazy import has to be
  // folded back in rather than emitted as a chunk nothing will be there to fetch.
  splitting: false,
  define: {
    "process.env.NODE_ENV": '"production"',
    // There is no import.meta in an IIFE, and assets.ts reads the deploy base
    // from it. Nothing in this build fetches by path anyway - every asset is a
    // data URI on window.__SL_INLINE - so the base is "/" and unused. Both
    // spellings, because the guard there tests the object before reading it.
    "import.meta.env": '{"BASE_URL":"/"}',
    "import.meta.env.BASE_URL": '"/"',
  },
});
const js = bundled.outputFiles[0].text;

const html = `<title>${LISTING_ONLY ? "Angela Rera Listing Builder" : "StudioLand content builder"}</title>
<style>
${css}
</style>
<div id="root"></div>
<script>window.__SL_INLINE = ${JSON.stringify(inline)};</script>
<script>${js}</script>
`;

// dist-single/ is gitignored, so it is missing on a fresh clone and writeFile
// will not create it.
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, html);
const kb = (s) => `${Math.round(s / 1024)}KB`;
console.log(`wrote ${OUT}`);
console.log(`  css ${kb(css.length)} · js ${kb(js.length)} · assets ${kb(JSON.stringify(inline).length)}`);
console.log(`  total ${kb(html.length)}`);
