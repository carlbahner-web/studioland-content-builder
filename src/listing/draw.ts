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
 *   4. the badge
 *   5. the type
 *
 * Getting 2 and 3 the other way round is the tempting mistake - a headshot
 * "behind the frame" sounds right - and it hides the arch entirely.
 */
import {
  CANVAS,
  FONT_FAMILY,
  OUTLINE_EM,
  PHOTO_BAND,
  TRACKING,
  coverRect,
  layoutText,
} from "./template.ts";
import type { Box, Measure, TextBlock } from "./template.ts";
import type { Doc } from "./doc.ts";
import manifest from "./layers.json";

export type LayerName = keyof typeof manifest;

/** The placed layer art, already loaded. Missing entries are simply not drawn. */
export type Art = Partial<Record<LayerName, CanvasImageSource>>;

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

export function applyFont(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.font = `${size}px "${FONT_FAMILY}", sans-serif`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${TRACKING * size}px`;
}

/** A Measure bound to a context. Cheap, but called per bisection step, so cached. */
export function measurer(ctx: CanvasRenderingContext2D): Measure {
  const cache = new Map<string, number>();
  return (line, size) => {
    const key = `${size}\u0000${line}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    applyFont(ctx, size);
    const w = ctx.measureText(line).width;
    cache.set(key, w);
    return w;
  };
}

export function drawBlock(ctx: CanvasRenderingContext2D, block: TextBlock, measure: Measure): void {
  const laid = layoutText(block, measure);
  ctx.save();
  applyFont(ctx, laid.size);
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
      ctx.lineWidth = laid.size * OUTLINE_EM * 2;
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

export type DrawOptions = {
  /** Canvas px per artboard px. The export passes 1. */
  scale?: number;
  /** Fills the photo band when there is no photo yet. */
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
  } else {
    ctx.fillStyle = placeholder;
    ctx.fillRect(PHOTO_BAND.x, PHOTO_BAND.y, PHOTO_BAND.w, PHOTO_BAND.h);
  }

  place(ctx, art, "frame");
  place(ctx, art, doc.headshot === "sitting" ? "headshot-sitting" : "headshot-arch");
  if (doc.badge === "sold") place(ctx, art, "badge-sold");
  if (doc.badge === "pending") place(ctx, art, "badge-pending");

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
