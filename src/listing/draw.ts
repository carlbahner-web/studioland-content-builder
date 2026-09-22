/* Painting a Doc onto a 2D context.
 *
 * One function, used for both the on-screen preview and the exported PNG, which
 * is the only way to be sure the download matches what was on screen. The
 * preview passes a smaller context and a scale; nothing else differs.
 *
 * Layer order is the whole trick, and it is not arbitrary - it follows how the
 * art was cut:
 *
 *   1. the listing photo, filling the band the frame leaves open
 *   2. the frame, whose keyed-out top is that band and whose arch and navy
 *      field cover everything below
 *   3. the headshot, over the frame: the "leaning" cut is the arch's fill and
 *      replaces the floral paper exactly, the "sitting" cut is a free cutout
 *      that stands in front of it
 *   4. the type, which is both the address and the badge
 *
 * Getting 2 and 3 the other way round is the tempting mistake - a headshot
 * "behind the frame" sounds right - and it hides the arch entirely.
 */
import {
  ARCH_MASK,
  CANVAS,
  FONT_FAMILY,
  PHOTO_BAND,
  coverRect,
  headshotFor,
  layoutText,
} from "./template.ts";
import type { Box, Measure, TextBlock } from "./template.ts";
import type { Doc } from "./doc.ts";
import manifest from "./layers.json";

export type LayerName = keyof typeof manifest;

/** The placed layer art, already loaded. Missing entries are simply not drawn. */
/* Keyed layers by their manifest name, plus the arch mask and the photographed
 * headshots by their own paths and keys. One bag, because they all arrive the
 * same way and are all optional until they land. */
export type Art = Partial<Record<string, CanvasImageSource>>;

export const LAYER_BOXES = manifest as Record<LayerName, Box & { frame: { w: number; h: number } }>;

/* Chrome and Edge have had ctx.letterSpacing since 99. Everything else gets the
 * type at natural tracking, which is looser than the design but legible - the
 * alternative, hand-kerning glyph by glyph, measures differently from the DOM
 * and would make the preview disagree with the export. */
export function supportsLetterSpacing(): boolean {
  try {
    const c = document.createElement("canvas").getContext("2d");
    return !!c && "letterSpacing" in c;
  } catch {
    return false;
  }
}

const HAS_LETTER_SPACING = /* @__PURE__ */ supportsLetterSpacing();

export function applyFont(ctx: CanvasRenderingContext2D, size: number, tracking: number): void {
  ctx.font = `${size}px "${FONT_FAMILY}", sans-serif`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${tracking * size}px`;
}

/** A Measure bound to a context. Cheap, but called per bisection step, so cached. */
export function measurer(ctx: CanvasRenderingContext2D): Measure {
  const cache = new Map<string, number>();
  return (line, size, tracking) => {
    // Tracking is in the key: the badge and the address are set at different
    // values, and a cache that ignores it hands one block the other's widths.
    const key = `${size}\u0000${tracking}\u0000${line}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    applyFont(ctx, size, tracking);
    const w = ctx.measureText(line).width;
    cache.set(key, w);
    return w;
  };
}

export function drawBlock(ctx: CanvasRenderingContext2D, block: TextBlock, measure: Measure): void {
  const laid = layoutText(block, measure);
  ctx.save();
  applyFont(ctx, laid.size, block.tracking);
  ctx.textAlign = block.align;
  ctx.textBaseline = "alphabetic";
  // Round join and miter cap, or the outline grows spikes off every sharp
  // corner in a geometric face - and this face is nothing but sharp corners.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.miterLimit = 2;
  for (const line of laid.lines) {
    if (!line.text) continue;
    if (block.outline) {
      // Stroke first, fill over: a centred stroke eats half its width into the
      // glyph, and filling afterwards hands that half back. Stroking after the
      // fill instead thins every stem by the outline weight.
      ctx.strokeStyle = block.outline;
      ctx.lineWidth = laid.size * block.outlineEm * 2;
      ctx.strokeText(line.text, line.x, line.y);
    }
    ctx.fillStyle = block.fill;
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();
}

function place(ctx: CanvasRenderingContext2D, art: Art, name: LayerName): void {
  const img = art[name];
  if (!img) return;
  const box = LAYER_BOXES[name];
  ctx.drawImage(img, box.x, box.y, box.w, box.h);
}

/* The arch's box, and one scratch canvas to clip a photograph into it.
 *
 * Module-level rather than per draw: this runs on every frame of a photo drag,
 * and allocating a 556x628 canvas sixty times a second to throw each one away
 * is the kind of thing that only shows up as jank on the machine you are not
 * testing on. Every draw is synchronous, so one is enough. */
const ARCH = LAYER_BOXES["headshot-arch"];
let scratch: HTMLCanvasElement | null = null;

function drawHeadshot(ctx: CanvasRenderingContext2D, key: string, art: Art): void {
  const shot = headshotFor(key);
  if (shot.layer) {
    place(ctx, art, shot.layer as LayerName);
    return;
  }
  const img = art[shot.key];
  const mask = art[ARCH_MASK];
  if (!img || !mask || !shot.photo) return;

  if (!scratch) {
    scratch = document.createElement("canvas");
    scratch.width = ARCH.w;
    scratch.height = ARCH.h;
  }
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, ARCH.w, ARCH.h);
  const r = coverRect(
    (img as HTMLImageElement).naturalWidth,
    (img as HTMLImageElement).naturalHeight,
    { x: 0, y: 0, w: ARCH.w, h: ARCH.h },
    shot.photo.fit,
  );
  sctx.drawImage(img, r.x, r.y, r.w, r.h);
  /* Clipped by the arch cutout's own alpha, so the edge is the artwork's edge
   * rather than a shape drawn here to resemble it. */
  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(mask, 0, 0, ARCH.w, ARCH.h);
  sctx.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, ARCH.x, ARCH.y);
}

export type DrawOptions = {
  /** Canvas px per artboard px. The export passes 1. */
  scale?: number;
  /** The band's backdrop: behind the photo, and all of it before there is one. */
  placeholder?: string;
};

export function drawDoc(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  art: Art,
  photo: CanvasImageSource | null,
  options: DrawOptions = {},
): void {
  const { scale = 1, placeholder = "#1b2b4b" } = options;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);

  /* The band's backdrop goes down FIRST and unconditionally, not as an
   * either/or with the photo. A photo zoomed below cover is letterboxed, and the
   * letterbox has to be the artwork's navy rather than whatever the canvas was
   * cleared to - otherwise zooming out punches a transparent hole through the
   * top of the graphic and the export carries it. */
  ctx.fillStyle = placeholder;
  ctx.fillRect(PHOTO_BAND.x, PHOTO_BAND.y, PHOTO_BAND.w, PHOTO_BAND.h);

  if (photo && doc.photo) {
    const r = coverRect(doc.photo.w, doc.photo.h, PHOTO_BAND, doc.photo.fit);
    ctx.save();
    // Clip, because a zoomed photo is larger than the band and the frame only
    // covers what is BELOW it - an overhang to the left or right of the band at
    // high zoom would otherwise paint over nothing and run off the artboard.
    ctx.beginPath();
    ctx.rect(PHOTO_BAND.x, PHOTO_BAND.y, PHOTO_BAND.w, PHOTO_BAND.h);
    ctx.clip();
    ctx.drawImage(photo, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  place(ctx, art, "frame");
  drawHeadshot(ctx, doc.headshot, art);

  const measure = measurer(ctx);
  for (const block of doc.blocks) drawBlock(ctx, block, measure);

  ctx.restore();
}

/** The artboard at full size, for download. */
export function renderFull(doc: Doc, art: Art, photo: CanvasImageSource | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  drawDoc(ctx, doc, art, photo);
  return canvas;
}
