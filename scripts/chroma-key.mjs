/* Turn the green-screen layer exports into transparent PNGs the editor can stack.
 *
 * The listing template was drawn in a design tool and handed over as five
 * 1080x1350 flats, each with everything-that-isn't-this-layer painted pure
 * green. That is a fine interchange format and a terrible runtime one, so this
 * runs once per art change: key the green out, crop each layer to the pixels
 * that survive, and write a manifest the app places them by.
 *
 * Two details matter more than the keying itself:
 *
 * - The edge pixels are BLENDED with the green, not merely near it. An
 *   antialiased edge holds `a*F + (1-a)*G`, so recovering F is a division, not
 *   a subtraction of some spill fudge. Skip it and every cutout wears a green
 *   rim that only shows up once it is composited over a photo.
 * - Cropping is most of the win. Four of the five layers are mostly empty, and
 *   a full-frame PNG of near-nothing still costs a full frame of filter bytes.
 *
 * Inputs are the exports in assets/listing-src/; the PNGs go to public/listing/
 * and the placement manifest to src/listing/layers.json. Both layouts go
 * through here - `mirror-*` is the same design with the arch on the other
 * side, drawn and exported as its own set of flats rather than flipped at
 * runtime, because the sitting cut-out was re-composed rather than mirrored.
 * Deliberately dependency-free (zlib is stdlib) so it works from a clean clone.
 *
 *   node scripts/chroma-key.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode, encode } from "./lib/png.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/listing-src");
const OUT = join(ROOT, "public/listing");
// The manifest is DATA the app imports, not an asset it fetches, so it belongs
// beside the code that reads it rather than in public/.
const MANIFEST = join(ROOT, "src/listing/layers.json");

/* ------------------------------------------------------------------ the key */

/* How far past the other two channels green has to run before a pixel counts as
 * backing. Below LO it is artwork and stays put; above HI it is backing and goes
 * entirely; between them it is an antialiased edge and gets a fraction.
 *
 * The window is wide on purpose. The darkest ink in these files is the navy
 * #081426, whose green sits 26 BELOW its blue, so every real pixel is far under
 * LO with room to spare, while the backing runs about +215. Nothing in this
 * artwork - navy, cream, skin, denim, the pink floral - is green-dominant, so
 * there is no legitimate pixel for a generous window to eat. */
const LO = 24;
const HI = 110;

/* Below this the recovered color is division-by-almost-nothing noise, and the
 * pixel is invisible anyway. Zero it rather than let a wrong color sit in a
 * channel some future resampling step might average back into view. */
const FLOOR = 0.05;

/* Layers whose ALPHA is a shape other things get clipped into, not just art to
 * stack. Each of these gets a second file beside it - white everywhere, alpha
 * copied across - which the app uses as a destination-in mask to cut a
 * photographed headshot to the arch's own edge. Written here rather than traced
 * by hand so the mask cannot drift from the arch it came from when the artwork
 * is redrawn: it IS the arch's alpha. */
const MASKS = new Set(["headshot-arch", "mirror-headshot-arch"]);

/** White RGB, alpha from the layer. Only the alpha is ever read. */
function alphaMask(w, h, rgba) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}

function key(w, h, rgba) {
  // The backing is not one exact value across the five files (two different
  // greens turned up), so measure it rather than hardcode it: the most common
  // strongly-green pixel IS the backing.
  const counts = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (g - Math.max(r, b) < HI) continue;
    const packed = (r << 16) | (g << 8) | b;
    counts.set(packed, (counts.get(packed) ?? 0) + 1);
  }
  let backing = 0x00ff24;
  let seen = 0;
  for (const [packed, n] of counts) {
    if (n > seen) {
      seen = n;
      backing = packed;
    }
  }
  const gr = (backing >> 16) & 255;
  const gg = (backing >> 8) & 255;
  const gb = backing & 255;

  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const src = rgba[i * 4 + 3] / 255;
    const d = g - Math.max(r, b);
    const keyed = 1 - Math.min(1, Math.max(0, (d - LO) / (HI - LO)));
    const a = keyed * src;
    if (a < FLOOR) continue; // leaves 0,0,0,0
    // Undo the composite against the backing: C = a*F + (1-a)*G, so F = (C - (1-a)*G)/a.
    out[i * 4] = Math.min(255, Math.max(0, Math.round((r - (1 - a) * gr) / a)));
    out[i * 4 + 1] = Math.min(255, Math.max(0, Math.round((g - (1 - a) * gg) / a)));
    out[i * 4 + 2] = Math.min(255, Math.max(0, Math.round((b - (1 - a) * gb) / a)));
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return { backing: `#${backing.toString(16).padStart(6, "0")}`, rgba: out };
}

function crop(w, h, rgba) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("layer keyed out completely");
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    rgba.copy(out, y * cw * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4);
  }
  return { x: x0, y: y0, w: cw, h: ch, rgba: out };
}

/* ------------------------------------------------------------------ the run */

mkdirSync(OUT, { recursive: true });

const manifest = {};
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".png")).sort()) {
  const slug = file.replace(/\.png$/, "");
  const { w, h, rgba } = decode(readFileSync(join(SRC, file)));
  const { backing, rgba: keyed } = key(w, h, rgba);
  const box = crop(w, h, keyed);
  const png = encode(box.w, box.h, box.rgba);
  writeFileSync(join(OUT, `${slug}.png`), png);
  manifest[slug] = { x: box.x, y: box.y, w: box.w, h: box.h, frame: { w, h } };
  let mask = "";
  if (MASKS.has(slug)) {
    // Cropped to the layer's own box, because that is the rect the app draws it
    // at - the mask and the arch are the same shape at the same size or the
    // clip lands somewhere else entirely.
    const bytes = encode(box.w, box.h, alphaMask(box.w, box.h, box.rgba));
    writeFileSync(join(OUT, `${slug}-mask.png`), bytes);
    manifest[slug].mask = `/listing/${slug}-mask.png`;
    mask = `  +mask ${(bytes.length / 1024).toFixed(0)}kB`;
  }
  const kb = (png.length / 1024).toFixed(0);
  console.log(
    `${slug.padEnd(24)} backing ${backing}  ` +
      `${box.w}x${box.h} at ${box.x},${box.y}  ${kb}kB${mask}`,
  );
}
mkdirSync(dirname(MANIFEST), { recursive: true });
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `\nwrote ${Object.keys(manifest).length} layers to public/listing/ and the manifest to src/listing/layers.json`,
);
