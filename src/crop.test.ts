import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coverBox, layerBox } from "./drawLayers.ts";
import { newImage } from "./layers.ts";
import { FORMATS } from "./brand.ts";

const square = FORMATS.find((f) => f.key === "post")!;
const ctx = null as unknown as CanvasRenderingContext2D;
// A wide photograph: 2:1.
const wide = { width: 2000, height: 1000 };
// And a tall one: 1:2.
const tall = { width: 1000, height: 2000 };

const covers = (
  box: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number,
) =>
  box.x <= -frameW / 2 + 1e-6 &&
  box.y <= -frameH / 2 + 1e-6 &&
  box.x + box.w >= frameW / 2 - 1e-6 &&
  box.y + box.h >= frameH / 2 - 1e-6;

test("the artwork covers the frame rather than fitting inside it", () => {
  const box = coverBox(wide, 400, 400, 1, 0.5, 0.5);
  assert.ok(covers(box, 400, 400), "a 2:1 photo in a square frame must overhang, not letterbox");
  // Covering a square from a 2:1 means matching the height and spilling sideways.
  assert.equal(box.h, 400);
  assert.equal(box.w, 800);
});

test("the aspect is never distorted, whichever way the frame is out of shape", () => {
  for (const img of [wide, tall]) {
    for (const [fw, fh] of [
      [400, 400],
      [600, 200],
      [200, 600],
    ]) {
      const box = coverBox(img, fw, fh, 1, 0.5, 0.5);
      assert.ok(
        Math.abs(box.w / box.h - img.width / img.height) < 1e-9,
        "the drawn box keeps the source aspect",
      );
      assert.ok(covers(box, fw, fh), `${img.width}x${img.height} must cover ${fw}x${fh}`);
    }
  }
});

test("the focal point moves the artwork under the frame", () => {
  const middle = coverBox(wide, 400, 400, 1, 0.5, 0.5);
  const left = coverBox(wide, 400, 400, 1, 0.1, 0.5);
  const right = coverBox(wide, 400, 400, 1, 0.9, 0.5);
  // Focusing on the LEFT of the artwork slides the artwork right under the frame.
  assert.ok(left.x > middle.x);
  assert.ok(right.x < middle.x);
});

/* The clamp is the whole reason a crop can be trusted: without it, dragging the
 * focus to a corner slides the artwork off its own frame and leaves a band of
 * ground showing through - and a crop that does not stay filled is not a crop. */
test("a focal point at the very edge still leaves the frame filled", () => {
  for (const [fx, fy] of [
    [0, 0],
    [1, 1],
    [0, 1],
    [1, 0],
    [-5, 9],
  ]) {
    const box = coverBox(wide, 400, 400, 1, fx, fy);
    assert.ok(covers(box, 400, 400), `focus ${fx},${fy} must still cover`);
  }
});

test("an axis with no slack cannot be panned at all", () => {
  // A 2:1 photo in a 2:1 frame has nothing spare in either direction.
  const a = coverBox(wide, 800, 400, 1, 0, 0);
  const b = coverBox(wide, 800, 400, 1, 1, 1);
  assert.deepEqual(a, b);
});

test("zoom only ever enlarges - below 1 would open a gap", () => {
  const one = coverBox(wide, 400, 400, 1, 0.5, 0.5);
  assert.deepEqual(coverBox(wide, 400, 400, 0.2, 0.5, 0.5), one);
  const two = coverBox(wide, 400, 400, 2, 0.5, 0.5);
  assert.equal(two.w, one.w * 2);
  assert.ok(covers(two, 400, 400));
});

test("zooming in opens up panning that was not there before", () => {
  // A 2:1 photo in a 2:1 frame is flush at zoom 1: the focal point has no
  // slack to work with and every value gives the same answer.
  assert.deepEqual(
    coverBox(wide, 800, 400, 1, 0.35, 0.5),
    coverBox(wide, 800, 400, 1, 0.5, 0.5),
  );
  // Zoomed in there is slack, so an off-centre focus actually moves it - while
  // a focus right at the edge still just pins that edge, clamped as it should be.
  const middle = coverBox(wide, 800, 400, 2, 0.5, 0.5);
  const off = coverBox(wide, 800, 400, 2, 0.35, 0.5);
  assert.ok(off.x !== middle.x, "zoomed in, the focal point can bite");
  assert.equal(coverBox(wide, 800, 400, 2, 0, 0.5).x, -400, "the edge still pins to the edge");
});

test("a framed layer takes the frame's box; an unframed one takes the artwork's", () => {
  const img = { width: 2000, height: 1000 } as HTMLImageElement;
  const assets = { "photo.jpg": img };
  const loose = newImage("photo.jpg", "upload", { w: 0.5 });
  assert.equal(layerBox(ctx, square, loose, assets)!.h, 270); // 2:1 of 540
  const cropped = newImage("photo.jpg", "upload", { w: 0.5, frameH: 0.5 });
  assert.equal(layerBox(ctx, square, cropped, assets)!.h, 540);
});
