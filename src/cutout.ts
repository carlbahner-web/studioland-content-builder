/* Taking the background out of an image.
 *
 * WHAT THIS IS: a flood fill inward from the edges, removing what is both
 * close in colour to the border AND connected to it. Not a global colour
 * match - that is the difference that matters. A photograph of an engineer in
 * a white shirt against a white wall loses the wall and keeps the shirt,
 * because the shirt is not touching the border. "Remove every white pixel"
 * would have punched a hole through him, and would have looked like it worked
 * until someone opened the export.
 *
 * WHAT THIS IS NOT: a matting model. It has no idea what a person is. Give it a
 * plain backdrop - a studio wall, a product on white, a logo on a flat field -
 * and it is exactly right and instant. Give it a band photo in a cluttered
 * rehearsal room and it will not save you, and no amount of tolerance-fiddling
 * will change that. The honest boundary is worth knowing before you reach for
 * it: this is the deterministic 90% case, not remove.bg.
 *
 * Everything in the first half of this file is pure - it takes pixels and
 * returns a mask - so the behaviour that matters can be tested rather than
 * eyeballed against a photograph.
 */

export type Cutout = {
  /** How far from the border colour still counts as background, 0 to 1. */
  tolerance: number;
  /** How many passes of edge softening, 0 to 6. */
  feather: number;
};

export const DEFAULT_CUTOUT: Cutout = { tolerance: 0.12, feather: 2 };

/* Anything already this transparent is background whatever its colour: a PNG
 * that arrives with holes in it keeps them, and its edges are seeded from them
 * rather than fought over. */
const CLEAR = 8;

/** The average colour of the border ring - what the fill is compared against. */
export function borderColor(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < CLEAR) return;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    take(0, y);
    take(w - 1, y);
  }
  if (!n) return [0, 0, 0];
  return [r / n, g / n, b / n];
}

/* The mask: 255 keep, 0 gone.
 *
 * Breadth-first from every border pixel that matches, four-connected, with an
 * explicit stack rather than recursion - a 2000px edge is millions of pixels
 * and recursion would blow the stack on the first real photograph. */
export function cutoutMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance: number,
): Uint8Array {
  const mask = new Uint8Array(w * h).fill(255);
  if (w < 2 || h < 2) return mask;

  const [br, bg, bb] = borderColor(data, w, h);
  // Compared in squared distance, so the per-pixel test needs no square root.
  const limit = (tolerance * 255) ** 2 * 3;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;

  const matches = (p: number): boolean => {
    const i = p * 4;
    if (data[i + 3] < CLEAR) return true;
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    return dr * dr + dg * dg + db * db <= limit;
  };

  const push = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    if (!matches(p)) return;
    mask[p] = 0;
    stack[top++] = p;
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (top > 0) {
    const p = stack[--top];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return mask;
}

/* Soften the edge.
 *
 * A hard mask cuts along the pixel grid and reads as a sticker with a jagged
 * outline, which is the giveaway that something was cut out. A few passes of a
 * 3x3 average turn that into a gradient a pixel or two wide. Separable, so each
 * pass is two linear sweeps rather than nine samples per pixel. */
export function feather(mask: Uint8Array, w: number, h: number, passes: number): Uint8Array {
  let out = mask;
  for (let n = 0; n < passes; n++) {
    const src = out;
    const mid = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const a = src[row + (x > 0 ? x - 1 : x)];
        const b = src[row + x];
        const c = src[row + (x < w - 1 ? x + 1 : x)];
        mid[row + x] = (a + b + c) / 3;
      }
    }
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const up = (y > 0 ? y - 1 : y) * w;
      const dn = (y < h - 1 ? y + 1 : y) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        next[row + x] = (mid[up + x] + mid[row + x] + mid[dn + x]) / 3;
      }
    }
    out = next;
  }
  return out;
}

/* ------------------------------------------------------------------- DOM */

/* The working size is capped. A 24MB photograph can be 8000x6000, which is 48
 * million pixels and nearly 200MB of ImageData for a mask nobody will ever see
 * at that resolution - the artboard's longest edge is 1920 and an image layer
 * is drawn smaller than that. 2048 is comfortably past anything that will be
 * displayed, and it makes the work bounded rather than dependent on what came
 * out of someone's camera. */
const MAX_SIDE = 2048;

const cache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();

const keyOf = (c: Cutout) => `${c.tolerance.toFixed(3)}:${Math.round(c.feather)}`;

/* The image with its background removed, or null if it could not be read.
 *
 * Null rather than a throw, and the caller draws the original: a cutout that
 * cannot be computed should look like a cutout that has not been asked for, not
 * like a layer that has vanished. getImageData throws on a canvas tainted by a
 * cross-origin image, which is the case that actually turns up. */
export function cutoutImage(img: HTMLImageElement, opts: Cutout): HTMLCanvasElement | null {
  let per = cache.get(img);
  if (!per) {
    per = new Map();
    cache.set(img, per);
  }
  const key = keyOf(opts);
  const hit = per.get(key);
  if (hit) return hit;

  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);

  let frame: ImageData;
  try {
    frame = g.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const soft = feather(
    cutoutMask(frame.data, w, h, opts.tolerance),
    w,
    h,
    Math.max(0, Math.min(6, Math.round(opts.feather))),
  );
  // The mask multiplies the alpha that was already there rather than replacing
  // it, so an image that arrived with soft edges keeps them.
  for (let p = 0; p < soft.length; p++) {
    frame.data[p * 4 + 3] = (frame.data[p * 4 + 3] * soft[p]) / 255;
  }
  g.putImageData(frame, 0, 0);

  // Bounded: a handful of settings per image, not one per drag of the slider.
  if (per.size > 8) per.clear();
  per.set(key, c);
  return c;
}
