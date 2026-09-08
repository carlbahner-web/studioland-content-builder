import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLORWAYS,
  PALETTE,
  FORMATS,
  VALUE_GAP,
  ctaReads,
  hueGap,
  inkFor,
  luminance,
  readsAgainst,
  valueGap,
} from "./brand.ts";

/* The two cases the game actually measured. These are the reason ctaReads()
 * tests value OR hue rather than either one alone: a value-only test rejects
 * both, and so does a contrast-ratio-only test. If someone later "simplifies"
 * that function to a single threshold, one of these two will break. */
test("the bible's measured CTA cases", () => {
  // Alert Red on rust measured 1.23:1 in the game. Invisible.
  assert.equal(ctaReads(PALETTE.ctaRed, PALETTE.rusty), false);
  assert.ok(valueGap(PALETTE.ctaRed, PALETTE.rusty) < VALUE_GAP);
  assert.ok(hueGap(PALETTE.ctaRed, PALETTE.rusty) < 60);

  // Neon Green on that same ground popped, on hue alone.
  assert.equal(ctaReads(PALETTE.neonGreen, PALETTE.rusty), true);
  assert.ok(
    valueGap(PALETTE.neonGreen, PALETTE.rusty) < VALUE_GAP,
    "green on rust should NOT pass on value - it passes on hue, which is the point",
  );
  assert.ok(hueGap(PALETTE.neonGreen, PALETTE.rusty) >= 60);
});

test("every shipped colorway is legal", () => {
  for (const cw of COLORWAYS) {
    const ground = PALETTE[cw.ground];

    // Headline has to separate from its ground as a field: value gap applies.
    assert.ok(
      readsAgainst(PALETTE[cw.ink], ground),
      `${cw.key}: ink ${cw.ink} on ${cw.ground} gap ${valueGap(PALETTE[cw.ink], ground).toFixed(3)}`,
    );

    // So does the accent - a keyword pop is a field, not a badge.
    assert.ok(
      readsAgainst(PALETTE[cw.accent], ground),
      `${cw.key}: accent ${cw.accent} on ${cw.ground}`,
    );

    // Action colors go through the value-or-hue rule.
    assert.ok(cw.ctas.length > 0, `${cw.key}: needs at least one legal CTA`);
    for (const cta of cw.ctas) {
      assert.ok(ctaReads(PALETTE[cta], ground), `${cw.key}: cta ${cta} on ${cw.ground}`);
    }

    // Badge ink must contrast the ground it sits on - boil trap #6.
    assert.ok(
      readsAgainst(PALETTE[inkFor(ground)], ground),
      `${cw.key}: badge ink ${inkFor(ground)} vanishes on ${cw.ground}`,
    );

    // The wordmark build has to be the one that shows up.
    const mark = cw.wordmark === "cream" ? PALETTE.offwhite : PALETTE.charcoal;
    assert.ok(readsAgainst(mark, ground), `${cw.key}: ${cw.wordmark} wordmark on ${cw.ground}`);
  }
});

test("the colors the bible forbids as grounds are not grounds", () => {
  const forbidden = new Set(["mustard", "neonGreen", "ctaRed", "foggyMint"]);
  for (const cw of COLORWAYS) {
    assert.ok(!forbidden.has(cw.ground), `${cw.key}: ${cw.ground} is not a ground`);
  }
});

test("luminance is sane", () => {
  assert.ok(luminance("#ffffff") > 0.99);
  assert.ok(luminance("#000000") < 0.01);
  assert.ok(luminance(PALETTE.offwhite) > luminance(PALETTE.charcoal));
});

test("formats are sane, and named for a job rather than a ratio", () => {
  assert.ok(FORMATS.length > 0);
  for (const f of FORMATS) {
    assert.ok(Number.isInteger(f.w) && f.w > 0, f.key);
    assert.ok(Number.isInteger(f.h) && f.h > 0, f.key);
    assert.ok(f.label.trim().length > 0, `${f.key} needs a label`);
    assert.ok(f.where.trim().length > 0, `${f.key} needs a "where it goes"`);
    // A label that is just the pixels puts the translation back on the reader,
    // which is the thing naming these by use case was meant to remove.
    assert.ok(!/^\d+\s*[x\u00d7]\s*\d+$/i.test(f.label.trim()), `${f.key}: label is a size`);
  }
  assert.equal(new Set(FORMATS.map((f) => f.key)).size, FORMATS.length, "format keys are unique");
});
