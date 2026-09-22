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
  ARCH_RIGHT,
  BADGE_BOX,
  ADDRESS_SIZE,
  BADGE_PRESETS,
  BADGE_SIZE,
  BADGE_TRACKING,
  TRACKING,
  GUTTER,
  TEXT_SLOTS,
  clampPhotoFit,
  containZoom,
  coverRect,
  layoutText,
  slotFor,
  zoomAt,
} from "./template.ts";
import type { TextBlock } from "./template.ts";
import { ADDRESS_SEED, addressBlock, badgeBlock, emptyDoc } from "./doc.ts";

const measure = (line: string, size: number, tracking: number) =>
  line.length * size * (0.5 + tracking + 0.1);

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
  assert.equal(containZoom(0, 0, PHOTO_BAND), 1);
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
  assert.equal(near(99), 4);
  assert.equal(near(2.5), 2.5);
  // The floor is "the whole photo is showing", not 1 - see containZoom.
  assert.equal(near(0.001), containZoom(3000, 2000, PHOTO_BAND));
});

test("the whole photo is inside the band at its contain zoom, and touching an edge", () => {
  for (const [w, h] of [
    [3000, 2000],
    [1000, 3000],
    [705, 705],
    [6000, 100],
  ]) {
    const zoom = containZoom(w, h, PHOTO_BAND);
    assert.ok(zoom <= 1 + 1e-9, `${w}x${h}: contain should never be larger than cover`);
    const r = coverRect(w, h, PHOTO_BAND, { zoom, offsetX: 0, offsetY: 0 });
    assert.ok(r.w <= PHOTO_BAND.w + 1e-6 && r.h <= PHOTO_BAND.h + 1e-6, `${w}x${h} overflows`);
    // Contain, not merely "smaller": one axis has to reach the band exactly.
    const snug =
      Math.abs(r.w - PHOTO_BAND.w) < 1e-6 || Math.abs(r.h - PHOTO_BAND.h) < 1e-6;
    assert.ok(snug, `${w}x${h} left slack on both axes, so it is not contained`);
  }
});

test("a photo smaller than the band can still be moved around inside it", () => {
  const zoom = containZoom(1000, 3000, PHOTO_BAND);
  const fit = clampPhotoFit(1000, 3000, PHOTO_BAND, { zoom, offsetX: 9999, offsetY: 0 });
  assert.ok(fit.offsetX > 0, "an inset photo should not be pinned to the centre");
  const r = coverRect(1000, 3000, PHOTO_BAND, fit);
  assert.ok(
    r.x + r.w <= PHOTO_BAND.w + 1e-6,
    `an inset photo was allowed outside the band: ${JSON.stringify(r)}`,
  );
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
  assert.ok(measure(b.text, laid.size, b.tracking) <= b.box.w + 1e-6, "still too wide after shrinking");
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

/* ----------------------------------------------------------------- the slots */

test("the address block sits where its slot says, at the slot's size and alignment", () => {
  const b = addressBlock();
  const slot = slotFor(b.slot);
  assert.deepEqual(b.box, slot.box);
  assert.equal(b.align, slot.align);
  assert.equal(b.size, slot.size);
});

test("an unknown slot falls back rather than leaving a block with no box", () => {
  assert.equal(slotFor("nowhere").key, TEXT_SLOTS[0].key);
});

test("every slot is inside the artboard", () => {
  for (const slot of TEXT_SLOTS) {
    const b = slot.box;
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= CANVAS.w && b.y + b.h <= CANVAS.h, slot.key);
  }
});

/* ------------------------------------------------------------- pinch to zoom */

test("zooming about a point leaves that point on the same part of the photo", () => {
  const band = PHOTO_BAND;
  const start = { zoom: 1, offsetX: 0, offsetY: 0 };
  // Where the anchor sits inside the photo, as a fraction of the photo's size.
  const where = (fit: typeof start, at: { x: number; y: number }) => {
    const r = coverRect(3000, 2000, band, fit);
    return { u: (at.x - r.x) / r.w, v: (at.y - r.y) / r.h };
  };
  for (const at of [
    { x: 100, y: 100 },
    { x: 540, y: 352 },
    { x: 1000, y: 640 },
  ]) {
    const before = where(start, at);
    for (const zoom of [1.5, 2.75, 4]) {
      const after = where(zoomAt(start, zoom, at, band), at);
      assert.ok(
        Math.abs(after.u - before.u) < 1e-9 && Math.abs(after.v - before.v) < 1e-9,
        `the photo slipped under the pinch at ${JSON.stringify(at)}, zoom ${zoom}`,
      );
    }
  }
});

test("zooming about the band's centre is the same as not anchoring at all", () => {
  const band = PHOTO_BAND;
  const centre = { x: band.x + band.w / 2, y: band.y + band.h / 2 };
  const fit = { zoom: 1, offsetX: 0, offsetY: 0 };
  assert.deepEqual(zoomAt(fit, 2, centre, band), { zoom: 2, offsetX: 0, offsetY: 0 });
});

test("an anchored zoom out is the exact inverse of the zoom in", () => {
  const band = PHOTO_BAND;
  const at = { x: 200, y: 500 };
  const fit = { zoom: 1.4, offsetX: 30, offsetY: -12 };
  const back = zoomAt(zoomAt(fit, 3.2, at, band), fit.zoom, at, band);
  assert.ok(Math.abs(back.offsetX - fit.offsetX) < 1e-9, `offsetX drifted to ${back.offsetX}`);
  assert.ok(Math.abs(back.offsetY - fit.offsetY) < 1e-9, `offsetY drifted to ${back.offsetY}`);
});

test("a zero zoom cannot make the anchored maths produce NaN", () => {
  const out = zoomAt({ zoom: 0, offsetX: 5, offsetY: 5 }, 2, { x: 10, y: 10 }, PHOTO_BAND);
  assert.ok(Number.isFinite(out.offsetX) && Number.isFinite(out.offsetY));
  assert.equal(out.zoom, 2);
});

test("a fresh doc is the address, an empty badge, and nothing else to go wrong", () => {
  const doc = emptyDoc();
  assert.equal(doc.photo, null);
  assert.equal(doc.headshot, "arch");
  assert.deepEqual(
    doc.blocks.map((b) => b.id),
    ["address", "badge"],
    "this template has two text blocks and no way to add a third",
  );
  assert.equal(doc.blocks[1].text, "", "a fresh listing is neither sold nor pending");
});

/* ----------------------------------------------------------------- the badge */

test("the type column keeps the same gutter from the arch and from the edge", () => {
  /* The strapline is baked into the frame art and set 37px from both edges.
     The guide rectangle was drawn to 23px from the arch and 20px from the edge,
     so the address sat closer to both than the line right under it. One value
     governs all of it now, and the badge inherits the column. */
  for (const box of [ADDRESS_BOX, BADGE_BOX]) {
    assert.equal(box.x - (ARCH_RIGHT + 1), GUTTER, "gutter to the arch");
    assert.equal(CANVAS.w - (box.x + box.w), GUTTER, "margin to the edge");
  }
});

test("the arch never reaches into the gutter beside the address", () => {
  // ARCH_RIGHT is measured off the keyed artwork; this is the guard that it
  // still describes it, so re-drawn art cannot quietly overlap the type.
  assert.ok(ARCH_RIGHT < ADDRESS_BOX.x, "the arch would overlap the address box");
});

test("the badge shares the address's centre line, which is the whole of its placement", () => {
  const centre = (b: { x: number; w: number }) => b.x + b.w / 2;
  assert.equal(centre(BADGE_BOX), centre(ADDRESS_BOX));
  assert.ok(BADGE_BOX.y + BADGE_BOX.h <= ADDRESS_BOX.y, "the badge overlaps the address");
});

test("both presets fit the badge box at its designed size and tracking", () => {
  /* The artwork's own ink widths at 130px / -0.2em, which is what the badge is
     set at - so this fails if the box, the size or the tracking is changed to
     something the words no longer fit. Whether TAY Wingman still renders them
     at those widths is asked in the browser suite. */
  const inkAt130 = { "SOLD!": 274, "PENDING!": 440 };
  assert.equal(BADGE_SIZE, 130, "the measured widths below are for 130px type");
  for (const preset of BADGE_PRESETS) {
    if (!preset.text) continue;
    const width = inkAt130[preset.text as keyof typeof inkAt130];
    assert.ok(width <= BADGE_BOX.w, `${preset.text} is ${width}px in ${BADGE_BOX.w}px`);
  }
});

test("the badge is tracked tighter than the address, and outlined heavier", () => {
  // Not a stylistic choice - both are measured off the flats. See TRACKING.
  assert.ok(BADGE_TRACKING < TRACKING, "the badge should be the tighter of the two");
  assert.equal(badgeBlock("SOLD!").tracking, BADGE_TRACKING);
  assert.equal(addressBlock().tracking, TRACKING);
  assert.ok(badgeBlock("SOLD!").outlineEm * BADGE_SIZE > addressBlock().outlineEm * ADDRESS_SIZE);
});

test("an empty badge lays out to nothing anyone can see", () => {
  const laid = layoutText(badgeBlock(""), measure);
  assert.deepEqual(
    laid.lines.map((l) => l.text),
    [""],
    "an empty badge should be one empty line, which drawBlock skips",
  );
});

test("a long badge shrinks rather than running into the arch", () => {
  const b = badgeBlock("UNDER CONTRACT!");
  const laid = layoutText(b, measure);
  assert.ok(laid.size < BADGE_SIZE, "it should have shrunk");
  assert.ok(measure(b.text, laid.size, b.tracking) <= BADGE_BOX.w + 1e-6);
});

