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

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = process.argv[2] ?? path.join(ROOT, "dist-single", "content-builder.html");

const MIME = {
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".png": "image/png",
};

/** Everything the running app asks for by path, as data URIs. */
const ASSETS = [
  "/brand/grain.webp",
  "/brand/studioland-wordmark-cream.png",
  "/brand/studioland-wordmark-charcoal.png",
  "/brand/buzz-wave.webp",
  "/brand/buzz-ride.webp",
  "/fonts/DWFairfield.woff2",
  "/fonts/DWFairfield-Narrow.woff2",
  "/fonts/TAYWingman.woff2",
];

async function dataUri(publicPath) {
  const file = path.join(ROOT, "public", publicPath.replace(/^\//, ""));
  const buf = await readFile(file);
  const mime = MIME[path.extname(file)] ?? "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const inline = {};
for (const p of ASSETS) inline[p] = await dataUri(p);

// The panel's own webfont is referenced from CSS, so swap that URL too.
let css = await readFile(path.join(ROOT, "src/studio.css"), "utf8");
css = css.replace(/url\("(\/fonts\/[^"]+)"\)/g, (_, p) => `url("${inline[p]}")`);

/* esbuild rather than Vite: one IIFE, no module graph, no import.meta - which
 * this app deliberately does not use, so nothing has to be stubbed. */
const bundled = await build({
  entryPoints: [path.join(ROOT, "src/main.tsx")],
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  target: ["es2022"],
  write: false,
  loader: { ".css": "empty" }, // the CSS is inlined above, not imported
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundled.outputFiles[0].text;

const html = `<title>StudioLand content builder</title>
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
