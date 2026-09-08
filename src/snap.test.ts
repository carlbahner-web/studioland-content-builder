import { strict as assert } from "node:assert";
import { test } from "node:test";
import { snapBox, snapTargets, snapThreshold, type Box } from "./snap.ts";

const T = snapThreshold(1080, 1080);
const bare = snapTargets(1080, 1080, 81, []);

test("the threshold is measured against the short edge, not the width", () => {
  // Otherwise the same near-miss snaps in a square and does not in a landscape.
  assert.equal(snapThreshold(1920, 1080), snapThreshold(1080, 1080));
});

test("a box near the middle takes the centre lines", () => {
  const box: Box = { cx: 543, cy: 537, w: 200, h: 100 };
  const out = snapBox(box, bare, T);
  assert.equal(out.cx, 540);
  assert.equal(out.cy, 540);
  assert.deepEqual(out.guides, [
    { axis: "x", at: 540 },
    { axis: "y", at: 540 },
  ]);
});

test("a box far from anything is left exactly where it is", () => {
  const box: Box = { cx: 300, cy: 700, w: 100, h: 100 };
  const out = snapBox(box, bare, T);
  assert.equal(out.cx, 300);
  assert.equal(out.cy, 700);
  assert.deepEqual(out.guides, []);
});

test("an edge snaps to the margin, not just the centre", () => {
  // Left edge at 84, margin at 81.
  const box: Box = { cx: 184, cy: 700, w: 200, h: 100 };
  const out = snapBox(box, bare, T);
  assert.equal(out.cx, 181);
  assert.deepEqual(out.guides, [{ axis: "x", at: 81 }]);
});

test("the two axes resolve independently", () => {
  // Left edge near the margin, centre near the vertical middle.
  const box: Box = { cx: 185, cy: 536, w: 200, h: 100 };
  const out = snapBox(box, bare, T);
  assert.equal(out.cx, 181);
  assert.equal(out.cy, 540);
  assert.equal(out.guides.length, 2);
});

test("the nearest line wins when two are in range", () => {
  const targets = { x: [500, 508], y: [] as number[] };
  const out = snapBox({ cx: 506, cy: 0, w: 0, h: 0 }, targets, T);
  assert.equal(out.cx, 508);
});

test("boxes snap to each other, edge to edge and centre to centre", () => {
  const other: Box = { cx: 800, cy: 300, w: 200, h: 200 };
  const targets = snapTargets(1080, 1080, 81, [other]);
  // A box whose centre is a hair off the other's left edge (700).
  const out = snapBox({ cx: 704, cy: 900, w: 0, h: 0 }, targets, T);
  assert.equal(out.cx, 700);
});

test("a rotated box passes no extent, so only its centre snaps", () => {
  // Its axis-aligned bounds are not its edges any more, so snapping them would
  // align an edge that is not where the guide says it is.
  const spun: Box = { cx: 540, cy: 184, w: 0, h: 0 };
  const out = snapBox(spun, bare, T);
  assert.equal(out.cx, 540);
  // 184 is within reach of the margin at 81 only via an edge, which it has none of.
  assert.equal(out.cy, 184);
});

test("an off-artboard box still snaps to the edges it is near", () => {
  const out = snapBox({ cx: -2, cy: 540, w: 0, h: 0 }, bare, T);
  assert.equal(out.cx, 0);
});
