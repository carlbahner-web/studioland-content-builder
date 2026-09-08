import { test } from "node:test";
import assert from "node:assert/strict";
import { layerBox } from "./drawLayers.ts";
import { hitRegion } from "./sheet.ts";
import { newImage, newShape, type ImageLayer, type Layer } from "./layers.ts";
import { FORMATS } from "./brand.ts";

const square = FORMATS.find((f) => f.key === "post")!;
const story = FORMATS.find((f) => f.key === "story")!;
const landscape = FORMATS.find((f) => f.key === "link")!;

// layerBox reads nothing off the context for an image or a shape - only a text
// layer has to be measured, and that needs a real canvas.
const ctx = null as unknown as CanvasRenderingContext2D;
const img = { width: 200, height: 100 } as HTMLImageElement;
const tall = { width: 100, height: 400 } as HTMLImageElement;
const images = { "arrow.svg": img };

const at = (over: Partial<ImageLayer> = {}) =>
  newImage("arrow.svg", "library", { id: "s1", x: 0.5, y: 0.5, w: 0.25, ...over });

const region = (l: Layer, size = square, assets = images) => {
  const box = layerBox(ctx, size, l, assets)!;
  return { id: l.id, label: l.name, ...box, rotation: l.rotation };
};

test("a layer keeps its size against the SHORT edge across every artboard", () => {
  // 25% of the short edge: 1080 in the square, 1080 in the story, 630 in the
  // landscape. Keyed to width, the story would be right and the landscape a
  // third too big.
  assert.equal(layerBox(ctx, square, at(), images)!.w, 270);
  assert.equal(layerBox(ctx, story, at(), images)!.w, 270);
  assert.equal(layerBox(ctx, landscape, at(), images)!.w, 157.5);
});

test("an image layer keeps its source aspect ratio", () => {
  assert.equal(layerBox(ctx, square, at(), images)!.h, 135); // 200x100 -> 2:1
  assert.equal(layerBox(ctx, square, at(), { "arrow.svg": tall })!.h, 1080); // 100x400 -> 1:4
});

test("position is relative, so one placement means the same thing everywhere", () => {
  const l = at({ x: 0.25, y: 0.8 });
  for (const size of [square, story, landscape]) {
    const { cx, cy } = layerBox(ctx, size, l, images)!;
    assert.equal(cx / size.w, 0.25);
    assert.equal(cy / size.h, 0.8);
  }
});

test("a shape sizes both edges against the short edge, so a square is square", () => {
  const box = layerBox(ctx, landscape, newShape("rect", { w: 0.5, h: 0.5 }), images)!;
  assert.equal(box.w, box.h);
});

test("a rule gets a grab box at least as tall as its own stroke", () => {
  // Its height is nearly nothing, so hit-testing it literally would mean
  // needing to land on a 2px line.
  const rule = newShape("line", { w: 0.5, h: 0.001, strokeWidth: 0.02 });
  const box = layerBox(ctx, square, rule, images)!;
  assert.ok(box.h >= 0.02 * 1080, "the stroke is the grab target");
});

test("an image whose file is not loaded has no box, and is skipped", () => {
  assert.equal(layerBox(ctx, square, at(), {}), null);
});

test("hit testing finds a layer under the point, and nothing outside it", () => {
  const r = [region(at())];
  assert.equal(hitRegion(r, 540, 540)?.id, "s1");
  assert.equal(hitRegion(r, 540 + 134, 540)?.id, "s1"); // just inside
  assert.equal(hitRegion(r, 540 + 136, 540), null); // just outside
  assert.equal(hitRegion(r, 10, 10), null);
});

test("hit testing follows a rotated layer", () => {
  // A point 60px right and 130px down of centre: outside the unrotated 270x135
  // box vertically, inside once the layer is turned 90 degrees.
  const px = 540 + 60;
  const py = 540 + 130;
  assert.equal(hitRegion([region(at())], px, py), null);
  assert.equal(hitRegion([region(at({ rotation: 90 }))], px, py)?.id, "s1");
});

test("the topmost layer wins", () => {
  const under = region(at({ id: "under" }));
  const over = region(at({ id: "over" }));
  assert.equal(hitRegion([under, over], 540, 540)?.id, "over");
});
