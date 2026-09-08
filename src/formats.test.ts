import { strict as assert } from "node:assert";
import { test } from "node:test";
import { customKey, formatProblem, isCustom, MAX_SIDE, MIN_SIDE } from "./formats.ts";
import { FORMATS } from "./brand.ts";
import { hydrate } from "./store.ts";
import type { Design } from "./sheet.ts";

const base: Design = { layers: [] };

test("a custom key can never collide with a built-in format", () => {
  const built = new Set(FORMATS.map((f) => f.key));
  for (let i = 0; i < 200; i++) {
    const k = customKey();
    assert.equal(built.has(k), false);
    assert.equal(isCustom({ key: k, label: "x", where: "x", w: 1, h: 1 }), true);
  }
});

test("built-in formats are not mistaken for custom ones", () => {
  for (const f of FORMATS) assert.equal(isCustom(f), false);
});

test("a size needs a name, because the name is what the list shows", () => {
  assert.ok(formatProblem("  ", 1080, 1080));
  assert.equal(formatProblem("Client one-pager", 1080, 1080), null);
});

test("sizes outside the workable range are refused with a reason", () => {
  assert.ok(formatProblem("x", MIN_SIDE - 1, 1080));
  assert.ok(formatProblem("x", 1080, MAX_SIDE + 1));
  assert.ok(formatProblem("x", Number.NaN, 1080));
  assert.equal(formatProblem("x", MIN_SIDE, MAX_SIDE), null);
});

/* The hazard custom sizes introduce: hydrate() drops overrides for formats it
 * does not recognise, so a design carrying per-format work for a custom size
 * loses it unless hydrate is told that size exists. */
test("overrides for a custom format survive when hydrate is told about it", () => {
  const mine = { key: "x-abc", label: "Client one-pager", where: "Custom size", w: 1200, h: 1200 };
  const kept = { kind: "image", id: "k", file: "kept.svg" };
  const raw = { overrides: { "x-abc": { layers: [kept] } }, format: "x-abc" };

  const blind = hydrate(raw, base)!;
  assert.deepEqual(blind.overrides, {}, "without the list, the work is dropped");
  assert.equal(blind.format.key, FORMATS[0].key);

  const told = hydrate(raw, base, [...FORMATS, mine])!;
  assert.equal(told.overrides["x-abc"].layers?.[0].id, "k");
  assert.equal(told.format.key, "x-abc");
});

test("an empty format list falls back rather than leaving nothing selectable", () => {
  const r = hydrate({ format: "post" }, base, [])!;
  assert.equal(r.format.key, "post");
});
