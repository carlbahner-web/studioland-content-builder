/* The listing template: where everything sits, and the arithmetic that puts it
 * there.
 *
 * Every number here was MEASURED off the artwork exports in assets/listing-src/
 * rather than eyeballed, because the whole point of a template editor is that
 * the person using it never has to nudge anything. If the art is redrawn, these
 * are re-measured - `node scripts/chroma-key.mjs` prints the layer boxes, and
 * the two below that it cannot know (the photo band and the address box) come
 * from the green hole in the frame and from the blue guide rectangle the
 * designer shipped for exactly this purpose.
 *
 * Kept free of DOM and canvas so the layout can be tested at a desk.
 */

import PHOTOS from "./photos.json" with { type: "json" };

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type TextAlign = "left" | "center" | "right";

/** Instagram portrait. The art is drawn at this size; nothing else is offered. */
export const CANVAS = { w: 1080, h: 1350 } as const;

/* The hole the frame leaves for the listing photo. The frame art starts at
 * y=605 (the arch) but does not become a solid horizon until y=705, so the
 * photo has to fill down to 705 and is then covered by the arch and the navy
 * field. Filling only to 605 leaves a 100px seam that is invisible against a
 * pale photo and glaring against a dark one. */
export const PHOTO_BAND: Box = { x: 0, y: 0, w: 1080, h: 705 };

/* The one spacing value in the template.
 *
 * It is the strapline's margin, measured off the artwork: "HIRE A REALTOR.
 * CLOSE WITH A FRIEND." is set 37px from both edges of the artboard. Everything
 * else in the type column now keeps the same distance from whatever it sits
 * next to, which is what makes the block look placed rather than fitted. */
export const GUTTER = 37;

/* Where the arch stops, beside the address. Measured, not assumed: the arch is
 * a curve, and at the address's first row it has not finished coming in
 * (x=548), but for the rest of the block it is straight-sided at x=555. The
 * widest point is what the gutter has to clear. */
export const ARCH_RIGHT = 555;

/* The designer's blue guide rectangle, with BOTH edges pulled in to the gutter.
 *
 * As drawn it ran from x=578 to x=1060 - 23px from the arch on one side, a 20px
 * margin on the other - while the strapline under it used 37px. So the address
 * sat closer to both the photograph and the edge than the line directly beneath
 * it, which is the sort of near-miss that reads as sloppy without being
 * obviously wrong.
 *
 * Narrowed rather than moved. Shifting the box would have kept the type size
 * and simply traded one crowded side for the other; the gutter is only worth
 * having on both. It costs 1.5px of type, which is why ADDRESS_SIZE is what it
 * is, and 3% of a 40px face is nothing anyone can see. */
/* The lower column is DISTRIBUTED, not inherited.
 *
 * Between the photo's bottom edge and the strapline there is a fixed 573px, and
 * two blocks of type to put in it. The artwork spent that space 41 / 28 / 64,
 * but both blocks are shorter here than the flats were - the badge by 31px
 * by 30px, because the column was narrowed to the gutter - so the slack pooled
 * at the bottom and the column read as drifting up away from the strapline.
 * (The badge was briefly short too, from being set at the wrong size and
 * tracking; that is fixed, and these numbers are the corrected ones.)
 *
 * So the gaps are equal instead: 573 - 86 (badge ink) - 306 (address ink) = 181,
 * over three gaps, is 60px each. The y values below are those targets converted
 * through what the font actually renders - the badge's cream cap lands 2px under
 * its box, the address's 1px over - which is why they are not simply 705+65 and
 * its successor. A browser test measures the three gaps on the real canvas and
 * fails if they drift apart, because that conversion is the part no arithmetic
 * here can be trusted about.
 */
export const HORIZON = 705;
export const STRAPLINE_TOP = 1278;
export const COLUMN_GAP = 60;

export const ADDRESS_BOX: Box = {
  x: ARCH_RIGHT + 1 + GUTTER,
  y: 911,
  w: CANVAS.w - GUTTER - (ARCH_RIGHT + 1 + GUTTER),
  h: 338,
};

/* CENTRED, not right-aligned, which is not what it looks like.
 *
 * Every line in the example ends at a different x - 1026, 1002, 989, 949 - and a
 * right margin that wanders by 77px reads as ragged-right at a glance. But all
 * six lines share a centre at x 819.5, which is the guide box's own centre to
 * within a pixel. They are centred, and the ragged right edge is just where the
 * letterforms happen to stop. Setting this to "right" lines the six lines up on
 * an edge the design does not have, and pulls the whole block sideways. */
export const ADDRESS_ALIGN: TextAlign = "center";

/* Type.
 *
 * Tracking is the one value the Character panel gives that survives contact with
 * the artwork: -100, which Photoshop counts in 1/1000 em, so -0.1em - the same
 * figure layers.ts already carries for this face.
 *
 * The other two panel values do NOT describe what this repo can draw, and it is
 * worth saying why rather than quietly carrying numbers that do not work. The
 * panel says 50.51pt; setting that here makes the longest line 561px wide in a
 * 482px box. Measuring each line's ink in the example against what TAY Wingman
 * actually renders puts the design at ~46.2px for the first four lines and
 * ~42.9px for the last two - two sizes, and neither of them 50.5. The likeliest
 * explanation is that the artwork was set in a different cut of the face than
 * the .woff2 in public/fonts/, and rather than guess at that, these are derived
 * from the font that ships:
 *
 *   - ADDRESS_SIZE clears the box on every seeded line with a little to spare,
 *     so nothing shrinks on a fresh document and a rounding difference between
 *     browsers cannot start a reflow. One size across the
 *     whole block, where the artwork used two; the difference is ~3px on two
 *     lines, and one address in one text field is the point of the tool.
 *   - CAP_RATIO is measured (actualBoundingBoxAscent of "H") rather than assumed,
 *     because it is what puts the first line's capitals ON the box's top edge.
 *   - LINE_HEIGHT is the artwork's own 42.25px pitch expressed against that size.
 *
 * tests/browser/listing.test.ts re-measures all three in a real browser, so a
 * swapped font file fails a test instead of quietly reflowing every graphic.
 */
export const FONT_FAMILY = "TAYWingman";

/* Tracking is PER BLOCK, because the artwork's two pieces of type do not share
 * it. The address is the Character panel's -100, i.e. -0.1em. The badge is
 * twice as tight, -0.2em, which is the whole reason it looked like a different
 * typeface for a while: measured against TAY Wingman's advance widths at -0.1em
 * it came out 27% too narrow for its height, and "a heavier condensed cut" is a
 * tidier explanation than the true one. It is not a different face. At 130px
 * and -0.2em this font renders SOLD! as a 274x89 ink box against the artwork's
 * 272x87, and PENDING! as 440x90 against 440x87 - the same letters, set tight.
 *
 * Two mistakes compounded into that wrong answer, and both are worth naming:
 * the artwork was measured as an INK box and compared against the font's
 * ADVANCE width, which is wider by the side bearings; and the badge was assumed
 * to share the address's tracking because the one Character panel that shipped
 * happened to be the address's. */
export const TRACKING = -0.1;
export const BADGE_TRACKING = -0.2;
export const ADDRESS_SIZE = 40;
export const LINE_HEIGHT = 0.973;
export const CAP_RATIO = 0.67;

/* Pink fill, navy outline - the badge art's colors, sampled from it.
 *
 * The outline is not an option anyone chose to add; it is what the artwork
 * does. Every piece of type in the handover carries it - SOLD! and PENDING!
 * plainly, in opaque navy, and the address more softly - and without it pale
 * pink type on a mid-value photo has no edge at all. It is drawn, not offered:
 * there is no control for it, because a listing where someone turned it off is
 * a listing that is off-brand.
 *
 * The outline in the address export could not be sampled the same way: it is
 * semi-transparent and the export baked it against the green backing, so the
 * flat #505923 sitting in that file is a blend, not a color anyone chose. The
 * badges, which are opaque, are the honest source for what the design means by
 * "outlined", and both are editable in the UI anyway. */
export const INK = "#ffe6ea";
export const OUTLINE = "#0b1c40";

/* Outline weight in em, outward from the glyph - also per block, because the
 * artwork's two strokes are not the same weight relative to their type. Both
 * are measured off the flats by separating the cream fill from the navy around
 * it: the address's sticks out 3px at ~45px type, the badge's 7px at 130px. */
export const OUTLINE_EM = 0.065;
export const BADGE_OUTLINE_EM = 0.054;

/* ------------------------------------------------------------------- layers */

/** A keyed layer, placed by the box scripts/chroma-key.mjs cropped it to. */
export type Placement = { x: number; y: number; w: number; h: number };

/* Two kinds of headshot, because the source material is two kinds.
 *
 * The first two were handed over already cut out, as green flats, and are drawn
 * straight from the keyed layer. The rest are photographs on a studio backdrop,
 * and are CLIPPED into the arch rather than matted out of the grey - which is
 * what the cut-out "Leaning" shot effectively already is, and avoids trying to
 * separate hair from seamless paper.
 *
 * Their placements are not guesses. Each was framed by hand in the Headshot
 * Positions tool and saved from there into photos.json, so re-cropping one is a
 * gesture in that tool and a paste here, not an afternoon of nudging numbers. */
export type Headshot = {
  key: string;
  label: string;
  /** A pre-cut layer, placed by the manifest. */
  layer?: string;
  /** Or a photograph, keyed off its backdrop, clipped to the arch, and placed
   *  by its saved fit. `matte` is the alpha; null where the crop shares another
   *  entry's photograph. */
  photo?: { file: string; matte: string | null; fit: PhotoFit };
};

export const HEADSHOTS: Headshot[] = [
  { key: "arch", label: "Leaning", layer: "headshot-arch" },
  { key: "sitting", label: "Sitting", layer: "headshot-sitting" },
  ...PHOTOS.shots.map((s) => ({
    key: s.key,
    label: s.label,
    photo: { file: s.file, matte: s.matte ?? null, fit: s.fit },
  })),
];

/** The alpha the photographed headshots are clipped by: the arch's own edge. */
export const ARCH_MASK = PHOTOS.mask;

/** Every image the tool loads that is not a keyed layer. */
export const PHOTO_FILES = [
  PHOTOS.mask,
  ...new Set(PHOTOS.shots.flatMap((s) => [s.file, s.matte].filter((f): f is string => !!f))),
];

/** Which headshot a document has chosen. */
export type HeadshotKey = string;

export function headshotFor(key: HeadshotKey): Headshot {
  return HEADSHOTS.find((h) => h.key === key) ?? HEADSHOTS[0];
}

/* The badge is TYPE, not artwork. What goes in it is these three to a click,
 * and anything else to a keystroke. */
export const BADGE_PRESETS = [
  { key: "none", label: "No badge", text: "" },
  { key: "sold", label: "SOLD!", text: "SOLD!" },
  { key: "pending", label: "PENDING!", text: "PENDING!" },
] as const;

/* ---------------------------------------------------------------- the photo */

/** How the uploaded photo is framed inside the band, before the user's nudge. */
export type PhotoFit = { zoom: number; offsetX: number; offsetY: number };

export const PHOTO_FIT: PhotoFit = { zoom: 1, offsetX: 0, offsetY: 0 };

/* Zoom is a MULTIPLE OF COVER, not of the photo's own pixels.
 *
 * That is what makes 1 mean the same thing for every photo: exactly filling the
 * band, whatever shape it came in. A multiplier of the photo's natural size
 * would put the useful range in a different place for a phone snap than for a
 * 6000px camera file, and the slider would be useless on one of them.
 */
export function coverRect(imgW: number, imgH: number, band: Box, fit: PhotoFit): Box {
  if (imgW <= 0 || imgH <= 0) return { ...band };
  const scale = Math.max(band.w / imgW, band.h / imgH) * Math.max(fit.zoom, 0.01);
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    x: band.x + (band.w - w) / 2 + fit.offsetX,
    y: band.y + (band.h - h) / 2 + fit.offsetY,
    w,
    h,
  };
}

/* The zoom at which the WHOLE photo is inside the band - contain rather than
 * cover, letterboxed on one axis. Always at or below 1.
 *
 * This is the floor of the zoom range rather than 1, because a listing photo is
 * usually 3:2 or 4:3 and the band is 1.53:1, so covering it crops the top and
 * bottom - which is often exactly the roofline and the yard someone wants. The
 * letterbox is filled with the artwork's own navy, so zooming out reads as a
 * deliberate inset rather than as a hole. */
export function containZoom(imgW: number, imgH: number, band: Box): number {
  if (imgW <= 0 || imgH <= 0) return 1;
  const cover = Math.max(band.w / imgW, band.h / imgH);
  const contain = Math.min(band.w / imgW, band.h / imgH);
  return contain / cover;
}

/* How far the photo may be dragged. Where it overflows the band, to the edge of
 * the overhang and no further, so it can never be pulled off and leave a gap;
 * where it is smaller than the band, to the edge of the band, so an inset photo
 * can be placed rather than stuck in the middle. Hence the absolute value: both
 * are the same "how much play is there on this axis" question. */
export function clampPhotoFit(imgW: number, imgH: number, band: Box, fit: PhotoFit): PhotoFit {
  const zoom = Math.min(4, Math.max(containZoom(imgW, imgH, band), fit.zoom));
  const placed = coverRect(imgW, imgH, band, { ...fit, zoom, offsetX: 0, offsetY: 0 });
  const slackX = Math.abs(placed.w - band.w) / 2;
  const slackY = Math.abs(placed.h - band.h) / 2;
  // `+ 0` normalises the negative zero that clamping to a zero-width range
  // produces, so a pinned axis reads as 0 rather than -0 wherever this value is
  // compared, serialised or shown.
  return {
    zoom,
    offsetX: Math.min(slackX, Math.max(-slackX, fit.offsetX)) + 0,
    offsetY: Math.min(slackY, Math.max(-slackY, fit.offsetY)) + 0,
  };
}

/* Zoom about a POINT rather than about the band's centre.
 *
 * This is what makes a pinch feel like a pinch: whatever is under the two
 * fingers has to stay under them. Zooming about the centre instead slides the
 * picture away while you are trying to frame a detail with it, and on a photo
 * held at 3x that is enough to make the gesture feel broken rather than
 * imprecise.
 *
 * The algebra: a point sits at `u` from the band's centre and the photo's own
 * centre sits at `offset`, so the point is `u - offset` from the photo's centre
 * in artboard units. Scaling by `k` scales that distance by `k`, and the offset
 * that keeps `u` where it is falls out as `u - (u - offset) * k`.
 */
export function zoomAt(fit: PhotoFit, nextZoom: number, anchor: Point, band: Box): PhotoFit {
  if (!(fit.zoom > 0)) return { ...fit, zoom: nextZoom };
  const k = nextZoom / fit.zoom;
  const ux = anchor.x - (band.x + band.w / 2);
  const uy = anchor.y - (band.y + band.h / 2);
  return {
    zoom: nextZoom,
    offsetX: ux - (ux - fit.offsetX) * k,
    offsetY: uy - (uy - fit.offsetY) * k,
  };
}

/* ----------------------------------------------------------------- the text */

/* Type sits in NAMED PLACES, and there is no dragging.
 *
 * This is a template, not a canvas: the address belongs where the designer put
 * it, and a graphic whose contact details have drifted four pixels left of the
 * last one is worse than one that cannot be adjusted at all. So a block names a
 * slot and the slot supplies the box, the size and the alignment.
 *
 * This template has exactly one, because it has exactly one piece of editable
 * type. The indirection still earns its keep: the mirrored version of this
 * design is the same tool with the boxes on the other side, which is a
 * different list here rather than a different editor.
 */
export type Slot = {
  key: string;
  label: string;
  box: Box;
  align: TextAlign;
  /** What a block moved into this slot is sized at, before shrink-to-fit. */
  size: number;
};

/* The badge sits on the address's own centre line, which is not obvious from
 * the artwork and is the thing to get right.
 *
 * SOLD! spans x 677-962 and PENDING! spans 593-1047 - different widths, and
 * neither left nor right edge shared. But both centre on x 819.5, which is the
 * address block's centre to within half a pixel. So it is the same column,
 * centred, sitting directly above it, and the size is the largest that clears
 * that column once it has been pulled in to the gutter on both sides. At 130px
 * and -0.2em tracking "PENDING!" measures a 440px ink box in a 450px column -
 * which is the artwork's own width, to the pixel, because it is the artwork's
 * own size and tracking. */
export const BADGE_BOX: Box = { x: ADDRESS_BOX.x, y: 763, w: ADDRESS_BOX.w, h: 140 };
export const BADGE_SIZE = 130;

export const TEXT_SLOTS: Slot[] = [
  { key: "address", label: "Address block", box: ADDRESS_BOX, align: ADDRESS_ALIGN, size: ADDRESS_SIZE },
  { key: "badge", label: "Badge", box: BADGE_BOX, align: "center", size: BADGE_SIZE },
];

export function slotFor(key: string): Slot {
  return TEXT_SLOTS.find((s) => s.key === key) ?? TEXT_SLOTS[0];
}

/* `fill` and `outline` are carried per block rather than read from the palette
 * at draw time so a future template can ship its own colors without every block
 * in this one changing underneath it. Nothing in the UI edits them. */
export type TextBlock = {
  id: string;
  text: string;
  /** Which of TEXT_SLOTS this sits in. The slot owns the position. */
  slot: string;
  /** The slot's box, copied in when the slot is set. Never edited by hand. */
  box: Box;
  /** Size in canvas px, before any shrink-to-fit. */
  size: number;
  align: TextAlign;
  fill: string;
  outline: string | null;
  /** Off for a block the user wants plain. */
  lineHeight: number;
  /** Letter-spacing in em. Not shared: see TRACKING. */
  tracking: number;
  /** Outline weight in em, outward from the glyph. */
  outlineEm: number;
};

export type LaidOutLine = {
  text: string;
  /** Where to start drawing, given ctx.textAlign set from the block's align. */
  x: number;
  /** Alphabetic baseline. */
  y: number;
};

export type LaidOutText = {
  lines: LaidOutLine[];
  /** The size actually used - the block's size, or less if it had to shrink. */
  size: number;
};

/** Width of a line at a given size and tracking. Supplied so this stays pure. */
export type Measure = (line: string, size: number, tracking: number) => number;

/* Shrink-to-fit rather than overflow.
 *
 * A template editor's one job is that whatever gets typed still looks composed,
 * and the realistic failure here is a long street name, not a novel: the address
 * box is sized for "373 Meetinghouse Ln" and someone will type "1247 Old
 * Gettysburg Pike Suite 210". Overflowing runs the type off the artwork; wrapping
 * silently re-breaks an address the person deliberately arranged into lines. So
 * the size gives, and the arrangement they typed survives.
 *
 * Bisection rather than a step-down loop because `measure` is a canvas call and
 * a 40px block of 8 lines would otherwise cost hundreds of them per keystroke.
 */
export function layoutText(block: TextBlock, measure: Measure): LaidOutText {
  const lines = block.text.split("\n");
  const fits = (size: number): boolean => {
    const height = (lines.length - 1) * size * block.lineHeight + size * CAP_RATIO;
    if (height > block.box.h) return false;
    for (const line of lines) {
      if (line && measure(line, size, block.tracking) > block.box.w) return false;
    }
    return true;
  };

  let size = block.size;
  if (!fits(size)) {
    let lo = 1;
    let hi = size;
    // 12 halvings takes a 200px block to under a tenth of a pixel of doubt.
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    size = lo;
  }

  const anchorX =
    block.align === "right"
      ? block.box.x + block.box.w
      : block.align === "center"
        ? block.box.x + block.box.w / 2
        : block.box.x;

  return {
    size,
    lines: lines.map((text, i) => ({
      text,
      x: anchorX,
      // First baseline sits a cap height below the box's top edge, so the top of
      // the capitals lands ON the edge. Measuring a box to the top of the type
      // is what a designer means by it; measuring to the em box is not.
      y: block.box.y + size * CAP_RATIO + i * size * block.lineHeight,
    })),
  };
}


