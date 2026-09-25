/* The reel title's arithmetic. `measure` is injected, as in the listing tests:
 * every glyph is 0.6em plus tracking, which is wrong about the font and right
 * for testing a layout that must not care. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BANNER_BOTTOM,
  CANVAS,
  CAP_RATIO,
  MAX_SIZE,
  PITCH,
  SAFE_BOX,
  SEED,
  breakTitle,
  clean,
  filenameFor,
  layoutTitle,
} from "./template.ts";

const measure = (line: string, size: number, tracking: number) =>
  line.length * size * 0.6 + Math.max(0, line.length - 1) * size * tracking;

test("titles are set in capitals, with spaces tidied", () => {
  assert.equal(clean("  pet   owners:\n  to fence "), "PET OWNERS:\nTO FENCE");
});

test("the seed breaks after its colon, never across it", () => {
  const { lines, manual } = breakTitle(SEED, measure);
  assert.equal(manual, false);
  assert.equal(lines[0], "PET OWNERS:");
  for (const line of lines) assert.ok(!/[:?] /.test(line), `"${line}" has a break inside it`);
});

test("a short title stays on one line at the ceiling size", () => {
  const { lines, size } = breakTitle("Sold", measure);
  assert.deepEqual(lines, ["SOLD"]);
  assert.equal(size, MAX_SIZE);
});

test("typed line breaks are kept exactly", () => {
  const { lines, manual } = breakTitle("Just\nlisted in\nMedia", measure);
  assert.equal(manual, true);
  assert.deepEqual(lines, ["JUST", "LISTED IN", "MEDIA"]);
});

const SAMPLES = [
  SEED,
  "Sold",
  "Open house this Sunday 1 to 3",
  "Five things nobody tells you about closing costs in Pennsylvania",
  "Just\nlisted",
];

test("every title's ink lands inside the safe box", () => {
  const b = SAFE_BOX;
  for (const t of SAMPLES) {
    const l = layoutTitle(t, measure);
    for (const line of l.lines) {
      assert.ok(line.x - line.w / 2 >= b.x - 0.01 && line.x + line.w / 2 <= b.x + b.w + 0.01, `${line.text} is ${line.w}px wide`);
    }
    assert.ok(l.ink.y >= b.y - 0.01, `${t}: top at ${l.ink.y}`);
    assert.ok(l.ink.y + l.ink.h <= b.y + b.h + 0.01, `${t}: bottom at ${l.ink.y + l.ink.h}`);
    assert.ok(Math.abs(l.ink.h - l.size * (CAP_RATIO + (l.lines.length - 1) * PITCH)) < 0.01);
  }
});

test("the block is centred in the safe box both ways", () => {
  for (const t of SAMPLES) {
    const { ink } = layoutTitle(t, measure);
    assert.ok(Math.abs(ink.x + ink.w / 2 - (SAFE_BOX.x + SAFE_BOX.w / 2)) < 0.01, `${t}: off centre sideways`);
    assert.ok(Math.abs(ink.y + ink.h / 2 - (SAFE_BOX.y + SAFE_BOX.h / 2)) < 0.01, `${t}: off centre vertically`);
  }
});

test("the safe box clears Instagram's buttons and Meta's side margins, and the banner sits under it", () => {
  assert.ok(SAFE_BOX.y >= 200, "below where the back arrow and camera button end");
  assert.ok(SAFE_BOX.x >= CANVAS.w * 0.06, "6% in from the sides");
  assert.equal(SAFE_BOX.x + SAFE_BOX.w, CANVAS.w - SAFE_BOX.x);
  assert.ok(BANNER_BOTTOM > SAFE_BOX.y + SAFE_BOX.h);
  assert.ok(BANNER_BOTTOM / CANVAS.h < 0.3, "the banner stays off the top third");
});

test("an empty title lays out nothing", () => {
  assert.equal(layoutTitle("   ", measure).lines.length, 0);
});

test("filenames", () => {
  assert.equal(filenameFor(SEED), "pet-owners-to-fence-or-not-to-fence-title.png");
  assert.equal(filenameFor("!!!"), "reel-title.png");
});
