import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addLayer,
  duplicateLayer,
  faceOf,
  findLayer,
  layerId,
  LAYER_COLORS,
  newImage,
  newShape,
  newText,
  removeLayer,
  reorderLayer,
  updateLayer,
  colorOf,
  type Layer,
} from "./layers.ts";
import { PALETTE } from "./brand.ts";

const three = (): Layer[] => [
  newText({ id: "a" }),
  newShape("rect", { id: "b" }),
  newImage("arrow.svg", "library", { id: "c" }),
];

test("ids are unique across a burst of calls in the same millisecond", () => {
  const ids = new Set(Array.from({ length: 500 }, () => layerId()));
  assert.equal(ids.size, 500);
});

test("every list edit returns a new array, so the history can see it", () => {
  const layers = three();
  assert.notEqual(addLayer(layers, newText()), layers);
  assert.notEqual(removeLayer(layers, "a"), layers);
  assert.notEqual(updateLayer(layers, "a", { x: 0.2 }), layers);
});

test("a duplicate sits directly above its original, offset so it is visible", () => {
  const layers = three();
  const { layers: next, id } = duplicateLayer(layers, "a");
  assert.equal(next.length, 4);
  assert.equal(next[0].id, "a");
  assert.equal(next[1].id, id);
  assert.notEqual(id, "a");
  assert.equal(next[2].id, "b");
  // Offset, or you cannot tell you made one.
  assert.notEqual(next[1].x, next[0].x);
  assert.notEqual(next[1].y, next[0].y);
});

test("duplicating something that is not there changes nothing", () => {
  const layers = three();
  const { layers: next, id } = duplicateLayer(layers, "nope");
  assert.equal(next, layers);
  assert.equal(id, null);
});

test("reorder moves by steps and clamps at both ends", () => {
  const ids = (ls: Layer[]) => ls.map((l) => l.id).join("");
  const layers = three();
  assert.equal(ids(reorderLayer(layers, "a", 1)), "bac");
  assert.equal(ids(reorderLayer(layers, "c", -1)), "acb");
  // Already at the bottom: nothing to do, and no crash.
  assert.equal(ids(reorderLayer(layers, "a", -1)), "abc");
  assert.equal(ids(reorderLayer(layers, "c", 1)), "abc");
  assert.equal(ids(reorderLayer(layers, "a", Infinity)), "bca");
  assert.equal(ids(reorderLayer(layers, "c", -Infinity)), "cab");
});

test("reordering an unknown id is a no-op rather than a splice at -1", () => {
  const layers = three();
  assert.equal(reorderLayer(layers, "nope", 1), layers);
});

test("findLayer handles a null selection", () => {
  const layers = three();
  assert.equal(findLayer(layers, null), null);
  assert.equal(findLayer(layers, "b")?.kind, "shape");
});

test("colours resolve through the palette, and a missing one falls back", () => {
  assert.equal(colorOf("mustard"), PALETTE.mustard);
  assert.equal(colorOf(null), null);
  assert.equal(colorOf(null, "#fff"), "#fff");
  // A design can outlive the palette that wrote it.
  assert.equal(colorOf("gone" as never, "#fff"), "#fff");
});

test("every offered layer colour is a real palette entry", () => {
  for (const key of LAYER_COLORS) assert.ok(PALETTE[key], `${key} is not in the palette`);
});

test("an unknown face falls back rather than throwing at draw time", () => {
  assert.equal(faceOf("body").family, "TAYWingman");
  assert.equal(faceOf("nope" as never).key, "display");
});

test("a rule starts as a line rather than a block", () => {
  const rule = newShape("line");
  assert.ok(rule.h < rule.w / 10);
  assert.equal(rule.fill, null);
  assert.ok(rule.stroke);
});
