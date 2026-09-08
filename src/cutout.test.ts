import { strict as assert } from "node:assert";
import { test } from "node:test";
import { borderColor, cutoutMask, feather } from "./cutout.ts";

/* A little image builder, so each case reads as a picture rather than as
 * arithmetic. `paint(x, y)` returns [r, g, b, a]. */
function image(w: number, h: number, paint: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const WHITE = [255, 255, 255];
const RED = [220, 40, 40];

/** A red square floating in the middle of a white field. */
const subject = (w = 20, h = 20, inset = 5) =>
  image(w, h, (x, y) =>
    x >= inset && x < w - inset && y >= inset && y < h - inset ? RED : WHITE,
  );

const at = (mask: Uint8Array, w: number, x: number, y: number) => mask[y * w + x];

test("the border colour is the average of the ring, not of the whole image", () => {
  // Mostly red, but the border is white - the border is what matters.
  const [r, g, b] = borderColor(subject(20, 20, 2), 20, 20);
  assert.ok(r > 240 && g > 240 && b > 240, `expected near-white, got ${r},${g},${b}`);
});

test("the background goes and the subject stays", () => {
  const mask = cutoutMask(subject(), 20, 20, 0.1);
  assert.equal(at(mask, 20, 0, 0), 0, "a corner is background");
  assert.equal(at(mask, 20, 10, 10), 255, "the middle of the subject is kept");
  assert.equal(at(mask, 20, 19, 19), 0, "the far corner too");
});

/* THE WHOLE POINT of flooding from the edge rather than matching colour
 * globally. A white shirt on a white wall keeps the shirt. Matching every white
 * pixel would punch a hole through the subject, and it would look like it
 * worked right up until someone opened the export. */
test("background-coloured pixels INSIDE the subject are kept", () => {
  const px = image(20, 20, (x, y) => {
    const inSubject = x >= 5 && x < 15 && y >= 5 && y < 15;
    if (!inSubject) return WHITE;
    // A white pocket in the middle of the red square.
    return x >= 9 && x < 11 && y >= 9 && y < 11 ? WHITE : RED;
  });
  const mask = cutoutMask(px, 20, 20, 0.1);
  assert.equal(at(mask, 20, 0, 0), 0, "the wall goes");
  assert.equal(at(mask, 20, 9, 9), 255, "the pocket stays - it is not connected to the border");
});

test("a subject touching the border is not eaten through", () => {
  // The red block runs to the bottom edge, so the fill meets it and stops.
  const px = image(20, 20, (x, y) => (x >= 5 && x < 15 && y >= 10 ? RED : WHITE));
  const mask = cutoutMask(px, 20, 20, 0.1);
  assert.equal(at(mask, 20, 10, 19), 255, "the part on the border survives");
  assert.equal(at(mask, 20, 0, 19), 0, "the background beside it does not");
});

test("tolerance decides how much drift still counts as background", () => {
  // A background that is not quite uniform: white fading to light grey.
  const px = image(20, 20, (x, y) => {
    if (x >= 5 && x < 15 && y >= 5 && y < 15) return RED;
    return [255 - x * 2, 255 - x * 2, 255 - x * 2];
  });
  const tight = cutoutMask(px, 20, 20, 0.005);
  const loose = cutoutMask(px, 20, 20, 0.2);
  const kept = (m: Uint8Array) => m.reduce((n, v) => n + (v ? 1 : 0), 0);
  assert.ok(kept(tight) > kept(loose), "a tight tolerance leaves more behind");
  assert.equal(at(loose, 20, 10, 10), 255, "the subject survives either way");
});

test("pixels that arrive transparent are background whatever their colour", () => {
  const px = image(20, 20, (x, y) =>
    x >= 5 && x < 15 && y >= 5 && y < 15 ? RED : [220, 40, 40, 0],
  );
  // The border is the SAME red as the subject, but it is already transparent.
  const mask = cutoutMask(px, 20, 20, 0.02);
  assert.equal(at(mask, 20, 0, 0), 0);
  assert.equal(at(mask, 20, 10, 10), 255);
});

test("an image with no background at all is left entirely alone", () => {
  // Every pixel is the subject; the border matches it, so everything floods.
  // The honest answer is that this image has no background to find.
  const px = image(10, 10, () => RED);
  const mask = cutoutMask(px, 10, 10, 0.01);
  assert.ok([...mask].every((v) => v === 0), "all of it reads as background");
});

test("a degenerate image does not crash", () => {
  for (const [w, h] of [
    [1, 1],
    [1, 10],
    [10, 1],
  ]) {
    const mask = cutoutMask(image(w, h, () => WHITE), w, h, 0.1);
    assert.equal(mask.length, w * h);
  }
});

test("feathering softens the edge without moving it", () => {
  const mask = cutoutMask(subject(), 20, 20, 0.1);
  const soft = feather(mask, 20, 20, 2);
  assert.equal(soft.length, mask.length);
  // Deep inside and far outside are untouched; the boundary picks up mid values.
  assert.equal(soft[10 * 20 + 10], 255);
  assert.equal(soft[0], 0);
  const partial = [...soft].filter((v) => v > 0 && v < 255).length;
  assert.ok(partial > 0, "there is a gradient now");
});

test("no feathering returns the mask untouched", () => {
  const mask = cutoutMask(subject(), 20, 20, 0.1);
  assert.equal(feather(mask, 20, 20, 0), mask);
});
