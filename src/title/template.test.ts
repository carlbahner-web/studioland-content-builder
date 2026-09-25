/* The reel title's arithmetic. `measure` is injected, as in the listing tests:
 * every glyph is 0.6em plus tracking, which is wrong about the font and right
 * for testing a layout that must not care. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CANVAS,
  CAP_RATIO,
  MAX_SIZE,
  MAX_TEXT_H,
  PITCH,
  SAFE_TOP,
  SEED,
  SIDE,
  bannerLowest,
  breakTitle,
  clean,
  filenameFor,
  layoutTitle,
  toCanvas,
} from "./template.ts";

const measure = (line: string, size: number, tracking: number) =>
  line.length * size * 0.6 + Math.max(0, line.length - 1) * size * tracking;

test("titles are set in capitals, with spaces tidied", () => {
  assert.equal(clean("  pet   owners:\n  to fence "), "PET OWNERS:\nTO FENCE");
});

test("the seed breaks where a person would, not just where it balances", () => {
  const { lines, manual } = breakTitle(SEED, measure);
  assert.equal(manual, false);
  assert.deepEqual(lines, ["PET OWNERS:", "TO FENCE", "OR NOT TO FENCE?"]);
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

test("every line fits across the frame and the block fits the height budget", () => {
  for (const t of [SEED, "Open house this Sunday 1 to 3", "Five things nobody tells you about closing costs in Pennsylvania", "x"]) {
    const l = layoutTitle(t, measure);
    for (const line of l.lines) assert.ok(line.w <= CANVAS.w - SIDE * 2 + 0.01, `${line.text} is ${line.w}px`);
    const h = l.size * (CAP_RATIO + (l.lines.length - 1) * PITCH);
    assert.ok(h <= MAX_TEXT_H + 0.01 || l.size === 36, `${t}: ${h}px tall`);
  }
});

test("no letter is under Instagram's buttons once the banner is turned", () => {
  for (const t of [SEED, "Sold", "A very long title that has to go on to four whole lines to fit"]) {
    const l = layoutTitle(t, measure);
    l.lines.forEach((line, i) => {
      const top = l.pivot.y + i * l.size * PITCH;
      for (const x of [line.x - line.w / 2, line.x + line.w / 2]) {
        const p = toCanvas(l, { x, y: top });
        assert.ok(p.y >= SAFE_TOP - 0.01, `${t}: ${line.text} reaches ${p.y}`);
      }
    });
  }
});

test("the title sits as close under the buttons as it can", () => {
  const l = layoutTitle(SEED, measure);
  const first = l.lines[0];
  const corner = toCanvas(l, { x: first.x + first.w / 2, y: l.pivot.y });
  assert.ok(Math.abs(corner.y - SAFE_TOP) < 0.5, `top line's corner is at ${corner.y}`);
});

test("the banner grows with the title, and a three-line one stays off her face", () => {
  const one = bannerLowest(layoutTitle("Sold", measure));
  const three = bannerLowest(layoutTitle(SEED, measure));
  assert.ok(one < three);
  assert.ok(three / CANVAS.h < 0.34, `covers ${Math.round((three / CANVAS.h) * 100)}%`);
});

test("an empty title lays out nothing", () => {
  assert.equal(layoutTitle("   ", measure).lines.length, 0);
});

test("filenames", () => {
  assert.equal(filenameFor(SEED), "pet-owners-to-fence-or-not-to-fence-title.png");
  assert.equal(filenameFor("!!!"), "reel-title.png");
});
