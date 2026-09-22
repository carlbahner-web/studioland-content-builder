/* The listing template's arithmetic, checked against the artwork it came from.
 *
 * `measure` is injected, so these run under bare node with no canvas: the fake
 * used here is "every glyph is 0.5em wide", which is wrong about the font and
 * exactly right for testing the layout, because the layout must not care.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ADDRESS_BOX,
  CANVAS,
  CAP_RATIO,
  PHOTO_BAND,
  clampBox,
  clampPhotoFit,
  coverRect,
  hits,
  layoutText,
  textBounds,
} from "./template.ts";
import type { TextBlock } from "./template.ts";
import { ADDRESS_SEED, addressBlock, emptyDoc, newBlock } from "./doc.ts";

const measure = (line: string, size: number) => line.length * size * 0.5;

function block(over: Partial<TextBlock> = {}): TextBlock {
  return { ...addressBlock(), ...over };
}

/* ---------------------------------------------------------------- the photo */

test("cover fills the band whatever shape the photo is", () => {
  for (const [w, h] of [
    [4000, 3000],
    [1000, 4000],
    [705, 705],
    [6000, 100],
  ]) {
    const r = coverRect(w, h, PHOTO_BAND, { zoom: 1, offsetX: 0, offsetY: 0 });
    assert.ok(r.w >= PHOTO_BAND.w - 1e-6, `${w}x${h} left a horizontal gap`);
    assert.ok(r.h >= PHOTO_BAND.h - 1e-6, `${w}x${h} left a vertical gap`);
    assert.ok(r.x <= 1e-6 && r.y <= 1e-6, `${w}x${h} started inside the band`);
  }
});

test("cover centres the overflow rather than favouring one edge", () => {
  const r = coverRect(2000, 1000, PHOTO_BAND, { zoom: 1, offsetX: 0, offsetY: 0 });
  assert.ok(Math.abs(r.x + r.w - (PHOTO_BAND.w - r.x)) < 1e-6);
});

test("a degenerate image falls back to the band instead of dividing by zero", () => {
  const r = coverRect(0, 0, PHOTO_BAND, { zoom: 1, offsetX: 0, offsetY: 0 });
  assert.deepEqual(r, { ...PHOTO_BAND });
});

test("the photo cannot be dragged off the band", () => {
  // Wider than the band, so the slack is sideways and the vertical axis is
  // pinned. (3:2 is NOT such a case - the band is 1.53:1, so a 3:2 photo
  // overflows vertically by a few pixels, which is the sort of thing that makes
  // an off-by-one in the clamp invisible until someone drags it.)
  const fit = clampPhotoFit(3000, 1000, PHOTO_BAND, { zoom: 1, offsetX: 9999, offsetY: 9999 });
  const r = coverRect(3000, 1000, PHOTO_BAND, fit);
  assert.ok(r.x <= 1e-6, "left edge pulled inside the band");
  assert.ok(r.x + r.w >= PHOTO_BAND.w - 1e-6, "right edge pulled inside the band");
  assert.equal(fit.offsetY, 0, "pinned axis should not move");
});

test("dragging is bounded on whichever axis actually has slack", () => {
  // Taller than the band: slack vertically, pinned sideways. The mirror of the
  // case above, and the one a clamp written for landscape photos gets wrong.
  const fit = clampPhotoFit(1000, 3000, PHOTO_BAND, { zoom: 1, offsetX: -9999, offsetY: -9999 });
  const r = coverRect(1000, 3000, PHOTO_BAND, fit);
  assert.equal(fit.offsetX, 0, "pinned axis should not move");
  assert.ok(r.y <= 1e-6 && r.y + r.h >= PHOTO_BAND.h - 1e-6, "dragged past the bottom edge");
});

test("zoom is clamped to the useful range", () => {
  const near = (v: number) => clampPhotoFit(3000, 2000, PHOTO_BAND, { zoom: v, offsetX: 0, offsetY: 0 }).zoom;
  assert.equal(near(0.1), 1, "below 1 would stop covering the band");
  assert.equal(near(99), 4);
  assert.equal(near(2.5), 2.5);
});

/* ----------------------------------------------------------------- the text */

test("the seeded address is the eight lines the artwork was measured from", () => {
  const lines = ADDRESS_SEED.split("\n");
  assert.equal(lines.length, 8);
  assert.deepEqual([lines[2], lines[5]], ["", ""], "the blank lines make the three groups");
});

/* Whether the seeded address fits at its designed 50.5px is a question about
 * TAY Wingman's actual widths, so it is asked in tests/browser/listing.test.ts
 * where the real font is loaded. What is checked here is the geometry: cap tops
 * on the box's top edge, the last baseline inside it, whatever the widths. */
test("the address lays out inside the designer's guide box", () => {
  const b = block();
  const laid = layoutText(b, measure);
  assert.equal(laid.lines.length, 8);
  const first = laid.lines[0];
  const last = laid.lines[7];
  // Cap tops sit ON the box's top edge, and the last baseline inside its bottom.
  assert.ok(Math.abs(first.y - (ADDRESS_BOX.y + laid.size * CAP_RATIO)) < 1e-9);
  assert.ok(last.y <= ADDRESS_BOX.y + ADDRESS_BOX.h + 1e-9, "the block overran its box");
});

test("right-aligned lines all anchor on the box's right edge", () => {
  const laid = layoutText(block({ align: "right" }), measure);
  for (const line of laid.lines) {
    assert.equal(line.x, ADDRESS_BOX.x + ADDRESS_BOX.w);
  }
});

test("centre and left anchor where they should", () => {
  assert.equal(layoutText(block({ align: "left" }), measure).lines[0].x, ADDRESS_BOX.x);
  assert.equal(
    layoutText(block({ align: "center" }), measure).lines[0].x,
    ADDRESS_BOX.x + ADDRESS_BOX.w / 2,
  );
});

test("a long street address shrinks instead of running off the artwork", () => {
  const b = block({ text: "1247 Old Gettysburg Pike, Suite 210, Mechanicsburg" });
  const laid = layoutText(b, measure);
  assert.ok(laid.size < b.size, "it should have shrunk");
  assert.ok(measure(b.text, laid.size) <= b.box.w + 1e-6, "still too wide after shrinking");
});

test("too many lines shrink too", () => {
  const b = block({ text: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") });
  const laid = layoutText(b, measure);
  const height = (laid.lines.length - 1) * laid.size * b.lineHeight + laid.size * CAP_RATIO;
  assert.ok(height <= b.box.h + 1e-6, "the block overran its box vertically");
});

test("shrinking never re-breaks the lines the person typed", () => {
  const text = "A very long first line indeed\nshort\nanother quite long line here";
  const laid = layoutText(block({ text }), measure);
  assert.deepEqual(
    laid.lines.map((l) => l.text),
    text.split("\n"),
  );
});

test("blank lines keep their place in the rhythm", () => {
  const laid = layoutText(block(), measure);
  const pitch = laid.size * addressBlock().lineHeight;
  for (let i = 1; i < laid.lines.length; i++) {
    assert.ok(Math.abs(laid.lines[i].y - laid.lines[i - 1].y - pitch) < 1e-9);
  }
  assert.equal(laid.lines[2].text, "");
});

test("bounds hug the widest line, on the side the block is aligned to", () => {
  const b = block({ text: "short\nmuch much longer line", align: "right" });
  const laid = layoutText(b, measure);
  const bounds = textBounds(b, laid, measure);
  assert.ok(Math.abs(bounds.x + bounds.w - (b.box.x + b.box.w)) < 1e-6);
  assert.ok(Math.abs(bounds.w - measure("much much longer line", laid.size)) < 1e-6);
});

test("hit testing is forgiving around the edges but not far from them", () => {
  const b = block();
  const bounds = textBounds(b, layoutText(b, measure), measure);
  assert.ok(hits(bounds, bounds.x + 4, bounds.y + 4));
  assert.ok(hits(bounds, bounds.x - 6, bounds.y - 6), "a near miss should still select");
  assert.ok(!hits(bounds, bounds.x - 200, bounds.y));
});

/* ---------------------------------------------------------------- the frame */

test("a block cannot be dragged off the artboard", () => {
  const far = clampBox({ x: 99999, y: 99999, w: 400, h: 200 });
  assert.ok(far.x < CANVAS.w && far.y < CANVAS.h);
  const near = clampBox({ x: -99999, y: -99999, w: 400, h: 200 });
  assert.ok(near.x + 400 >= 40, "dragged out to the left with nothing left on screen");
  assert.equal(near.y, 0);
});

test("a fresh doc has the address and nothing else to go wrong", () => {
  const doc = emptyDoc();
  assert.equal(doc.photo, null);
  assert.equal(doc.headshot, "arch");
  assert.equal(doc.badge, "none");
  assert.deepEqual(
    doc.blocks.map((b) => b.id),
    ["address"],
  );
});

test("added blocks get distinct ids", () => {
  const ids = new Set([newBlock().id, newBlock().id, newBlock().id]);
  assert.equal(ids.size, 3);
  assert.ok(!ids.has("address"), "an added block must never collide with the template's");
});
