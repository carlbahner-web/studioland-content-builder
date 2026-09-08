import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOIL_CYCLE_FRAMES,
  boilPhase,
  misregOffset,
  setBoilFrame,
  setInkMode,
} from "./boil.ts";

/* misregOffset reads the same phase the linework does, so it is a usable proxy
 * for "what is the ink doing" without needing a canvas. */
function offsetAt(mode: "off" | "still" | "live", frame: number | null) {
  setInkMode(mode);
  setBoilFrame(frame, 1);
  return misregOffset(1);
}

test("off means nothing moves and nothing is offset", () => {
  assert.deepEqual(offsetAt("off", null), { dx: 0, dy: 0 });
  assert.deepEqual(offsetAt("off", 7), { dx: 0, dy: 0 });
});

test("still holds one drawing across every frame", () => {
  const a = offsetAt("still", 0);
  for (const f of [1, 5, 11, 37, 99, 179]) {
    assert.deepEqual(offsetAt("still", f), a, `frame ${f} moved in still mode`);
  }
  assert.notDeepEqual(a, { dx: 0, dy: 0 }, "still is one phase HELD, not the ink switched off");
});

test("live cycles through all three phases", () => {
  const seen = new Set<string>();
  for (let f = 0; f < BOIL_CYCLE_FRAMES; f++) {
    const { dx, dy } = offsetAt("live", f);
    seen.add(`${dx},${dy}`);
  }
  assert.equal(seen.size, 3, "the boil steps between exactly three drawings");
});

/* Wobble.tsx picks the MIDDLE drawing as its still for a reason: going live
 * from it does not jump on the first frame. The generator copies that, so a PNG
 * and the first frame of the same design's MP4 are the same picture. */
test("the still is the middle phase, so going live does not jump", () => {
  const still = offsetAt("still", null);
  const midFrame = BOIL_CYCLE_FRAMES / 3; // first frame of phase 1
  assert.equal(boilPhase(midFrame), 1);
  assert.deepEqual(offsetAt("live", midFrame), still);
});

test("a still render holds the middle phase even in live mode", () => {
  // frame null = a PNG. It must not depend on which mode is selected.
  assert.deepEqual(offsetAt("live", null), offsetAt("still", null));
});

test("the loop closes on a whole number of boil cycles", () => {
  const LOOP_FRAMES = 180; // socialAd.ts; imported there via a DOM module
  assert.equal(LOOP_FRAMES % BOIL_CYCLE_FRAMES, 0);
  assert.equal(boilPhase(0), boilPhase(LOOP_FRAMES));
});
