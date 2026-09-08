import { test } from "node:test";
import assert from "node:assert/strict";
import { hitSticker, stickerBox, type Sticker } from "./templates/socialAd.ts";
import { FORMATS } from "./brand.ts";

const square = FORMATS.find((f) => f.key === "post")!;
const story = FORMATS.find((f) => f.key === "story")!;
const landscape = FORMATS.find((f) => f.key === "link")!;

// stickerBox only reads width/height off the image.
const img = { width: 200, height: 100 } as HTMLImageElement;
const tall = { width: 100, height: 400 } as HTMLImageElement;

const at = (over: Partial<Sticker> = {}): Sticker => ({
  id: "s1",
  name: "arrow.svg",
  x: 0.5,
  y: 0.5,
  scale: 0.25,
  rotation: 0,
  ...over,
});

test("a sticker keeps its size against the SHORT edge across every artboard", () => {
  const s = at();
  // 25% of the short edge: 1080 in the square, 1080 in the story, 630 in the
  // landscape. If this were keyed to width, the story would be right and the
  // landscape would be a third too big.
  assert.equal(stickerBox(square, s, img).w, 270);
  assert.equal(stickerBox(story, s, img).w, 270);
  assert.equal(stickerBox(landscape, s, img).w, 157.5);
});

test("a sticker keeps its source aspect ratio", () => {
  assert.equal(stickerBox(square, at(), img).h, 135); // 200x100 -> 2:1
  assert.equal(stickerBox(square, at(), tall).h, 1080); // 100x400 -> 1:4
});

test("position is relative, so one placement means the same thing everywhere", () => {
  const s = at({ x: 0.25, y: 0.8 });
  for (const size of [square, story, landscape]) {
    const { cx, cy } = stickerBox(size, s, img);
    assert.equal(cx / size.w, 0.25);
    assert.equal(cy / size.h, 0.8);
  }
});

test("hit testing finds a sticker under the point, and nothing outside it", () => {
  const s = at();
  const imgs = { "arrow.svg": img };
  assert.equal(hitSticker(square, [s], imgs, 540, 540)?.id, "s1");
  assert.equal(hitSticker(square, [s], imgs, 540 + 134, 540)?.id, "s1"); // just inside
  assert.equal(hitSticker(square, [s], imgs, 540 + 136, 540), null); // just outside
  assert.equal(hitSticker(square, [s], imgs, 10, 10), null);
});

test("hit testing follows a rotated sticker", () => {
  const imgs = { "arrow.svg": img };
  // A point 130px right and 60px down of centre: outside the unrotated 270x135
  // box vertically, inside once the sticker is turned 90 degrees.
  const px = 540 + 60;
  const py = 540 + 130;
  assert.equal(hitSticker(square, [at()], imgs, px, py), null);
  assert.equal(hitSticker(square, [at({ rotation: 90 })], imgs, px, py)?.id, "s1");
});

test("the topmost sticker wins", () => {
  const under = at({ id: "under" });
  const over = at({ id: "over" });
  const imgs = { "arrow.svg": img };
  assert.equal(hitSticker(square, [under, over], imgs, 540, 540)?.id, "over");
});

test("a sticker whose file is not loaded is skipped, not crashed on", () => {
  assert.equal(hitSticker(square, [at()], {}, 540, 540), null);
});
