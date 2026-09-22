/* Key the studio backdrop out of the photographed headshots.
 *
 * The first two headshots were handed over already cut out, so the floral paper
 * of the arch shows behind them. These four arrived on grey seamless, so they
 * covered it. This makes a MATTE for each - an alpha channel, shipped beside the
 * untouched JPEG - and the app multiplies the two at draw time.
 *
 * Matte beside the photo rather than one RGBA PNG: a 1050x1400 photograph as PNG
 * is well over a megabyte, and this bundle is downloaded to a phone. The colour
 * stays a JPEG and the alpha is its own small greyscale file.
 *
 * The keying itself is src/cutout.ts, which the content builder already uses and
 * which is tested: a flood fill inward from the edges, removing what is both
 * close to the border colour AND connected to it. That distinction is the whole
 * point here - the patterned dress and the pale jeans have near-background
 * values in them, and a global "remove every light pixel" would punch holes
 * through both. It is not a matting model and does not pretend to be; the place
 * it shows its limits is hair against a light backdrop, which is exactly what
 * these photographs are, so LOOK at the result rather than trusting the run.
 *
 * Two things had to be added on top of it, both visible in the first pass and
 * neither guessable from a kept-percentage:
 *
 * 1. Tolerance is per photograph. One number cannot serve all four. The dress
 *    is a white-on-black print, and at a tolerance loose enough for the other
 *    backdrops the white of the print is within range of the seamless AND
 *    touching the silhouette, so the fill walks in through it and eats the
 *    hem, a forearm and both legs. That frame needs a tight tolerance; the
 *    others need a loose one to clear a lit gradient. `tolerance` in
 *    photos.json, beside the crop it belongs to.
 *
 * 2. Backdrop the fill cannot reach. An arm on a hip encloses a pocket of
 *    seamless that touches no border, so the flood never arrives and a grey
 *    hole is left sitting on the pink. Those are removed afterwards by colour,
 *    not by size: a pocket is neutral and all but identical to the border
 *    average, where the pale jeans that the connectivity test exists to
 *    protect sit several times further away. See HOLE_TOLERANCE.
 *
 *   node --experimental-strip-types scripts/matte.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { decode, encode } from "./lib/png.mjs";
import { borderColor, cutoutMask, feather } from "../src/cutout.ts";
import photos from "../src/listing/photos.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

/* Wider than the content builder's 0.12 default. These backdrops are lit with a
 * gradient - brighter behind her head than at the floor - so one border average
 * has to cover both ends of it, and too tight a tolerance leaves a grey collar
 * around the top of the frame. Overridden per shot in photos.json where the
 * subject cannot survive it. */
const TOLERANCE = 0.19;
const FEATHER = 2;

/* How close to the border average an unreachable pocket has to be before it is
 * taken for backdrop rather than subject. Measured, not chosen: the seamless in
 * the crook of an arm sits within about 0.03 of the border average, and the
 * palest jeans in this set are past 0.07. 0.05 is the gap between them, and
 * being under every shot's TOLERANCE it can only ever remove pixels the main
 * fill would have removed had it been able to get to them. */
const HOLE_TOLERANCE = 0.05;

/* And a ceiling anyway, as a fraction of the frame. Colour is the real test;
 * this is the seatbelt. A pocket under an arm is well under one percent, so
 * anything approaching a twentieth of the picture is not a pocket and is more
 * likely a garment that happens to be grey - in which case look at it and
 * decide by hand rather than letting the script quietly delete her. */
const HOLE_MAX_AREA = 0.05;

/* Backdrop the border fill could not reach, cleared by colour. Four-connected
 * over the pixels the main pass kept, so a pocket is grown from its own
 * neighbours and stops at the arm around it. */
function fillHoles(mask, data, w, h, [br, bg, bb]) {
  const limit = (HOLE_TOLERANCE * 255) ** 2 * 3;
  const cap = w * h * HOLE_MAX_AREA;
  const near = (p) => {
    const i = p * 4;
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    return dr * dr + dg * dg + db * db <= limit;
  };
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const run = new Int32Array(w * h);
  let cleared = 0;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !mask[start] || !near(start)) continue;
    let top = 0;
    let n = 0;
    seen[start] = 1;
    stack[top++] = start;
    while (top > 0) {
      const p = stack[--top];
      run[n++] = p;
      const x = p % w;
      const y = (p - x) / w;
      const push = (q) => {
        if (seen[q] || !mask[q] || !near(q)) return;
        seen[q] = 1;
        stack[top++] = q;
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    if (n > cap) continue;
    for (let i = 0; i < n; i++) mask[run[i]] = 0;
    cleared += n;
  }
  return cleared;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    // Same fallback as tests/browser/harness.ts: a pre-baked image keeps its
    // browsers somewhere Playwright's own resolver does not look.
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw err;
    const dir = readdirSync(root).find((d) => d.startsWith("chromium-"));
    if (!dir) throw err;
    return chromium.launch({ executablePath: `${root}/${dir}/chrome-linux/chrome` });
  }
}

const browser = await launch();
const page = await browser.newPage();
await page.goto("about:blank");

for (const shot of photos.shots) {
  // One entry per crop, one file per photograph: "Dress, wide" and "Dress,
  // close" are the same frame and must not be keyed, or shipped, twice.
  if (shot.matte === null) continue;
  const file = join(PUBLIC, shot.file.replace(/^\//, ""));
  const b64 = readFileSync(file).toString("base64");

  // Chromium decodes the JPEG; png.mjs cannot. It hands back a PNG this script
  // can decode itself, rather than a few million numbers through the bridge.
  const pngUrl = await page.evaluate(async ([src]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  }, [`data:image/jpeg;base64,${b64}`]);

  const { w, h, rgba } = decode(Buffer.from(pngUrl.split(",")[1], "base64"));
  const data = new Uint8ClampedArray(rgba);
  const border = borderColor(data, w, h);
  const [br, bg, bb] = border;
  const tolerance = shot.tolerance ?? TOLERANCE;
  const hard = cutoutMask(data, w, h, tolerance);
  const holes = fillHoles(hard, data, w, h, border);
  const mask = feather(hard, w, h, FEATHER);

  // White everywhere, alpha from the mask: the app multiplies this into the
  // photo, so only the alpha channel is ever read.
  const out = Buffer.alloc(w * h * 4);
  let kept = 0;
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = mask[i];
    if (mask[i] > 127) kept++;
  }
  const png = encode(w, h, out);
  const dest = join(PUBLIC, shot.matte.replace(/^\//, ""));
  writeFileSync(dest, png);
  console.log(
    `${shot.key.padEnd(18)} border rgb(${br.toFixed(0)},${bg.toFixed(0)},${bb.toFixed(0)})  ` +
      `tol ${tolerance}  kept ${((kept / (w * h)) * 100).toFixed(1)}%  ` +
      `holes ${((holes / (w * h)) * 100).toFixed(2)}%  ${(png.length / 1024).toFixed(0)}kB`,
  );
}

await browser.close();
