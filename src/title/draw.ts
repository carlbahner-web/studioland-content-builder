/* Painting a reel title onto a 2D context.
 *
 * One function for the preview and the export, as in the listing builder, so
 * the download is what was on screen.
 *
 * The peony paper is not a new asset. It is cut out of the listing frame that
 * already ships: the navy field to the right of the arch, below the photo band
 * and above the strapline, is 514x570px of clean pattern. And because the
 * mirrored listing layout is an exact reflection of that field, laying the crop
 * next to its own mirror image continues the pattern without a seam - the
 * designer's own mirror, used as a tile. Flipped top-to-bottom as well, so a
 * tall banner can repeat downwards the same way.
 */
import { applyFont, measurer, supportsLetterSpacing } from "../listing/draw.ts";
import {
  BANNER_NAVY,
  CANVAS,
  TRACKING,
  TYPE_INK,
  layoutTitle,
} from "./template.ts";
import type { Measure, TitleLayout } from "./template.ts";

const HAS_LETTER_SPACING = /* @__PURE__ */ supportsLetterSpacing();

/* The listing builder's measurer, less the trailing letter-space - which only
 * exists where the browser applies tracking at all. Older iOS Safari does not,
 * sets the title untracked, and must not have a space subtracted that it never
 * added. */
export function titleMeasurer(ctx: CanvasRenderingContext2D): Measure {
  const m = measurer(ctx);
  return (line, size, tracking) => m(line, size, tracking) - (HAS_LETTER_SPACING ? size * tracking : 0);
}

/** Where the clean pattern sits inside /listing/frame.png (frame-local px). */
export const PAPER_CROP = { x: 566, y: 100, w: 514, h: 570 } as const;

/* Enlarged a little: at 1:1 the flowers are sized for a 1080px square post and
 * look busy across a banner this wide. */
const PAPER_SCALE = 1.25;

/* The overhang past the frame on every side of the banner, in its own frame.
 * The banner is turned, so a rectangle exactly the frame's width would show
 * transparent corners; this is comfortably more than the turn exposes. */
const BLEED = 400;

/** The frame art, already loaded. The paper is cut from it once. */
export function makePaper(frame: CanvasImageSource | undefined): HTMLCanvasElement | null {
  if (!frame) return null;
  const { x, y, w, h } = PAPER_CROP;
  const tile = document.createElement("canvas");
  tile.width = w * 2;
  tile.height = h * 2;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  // Four copies: as drawn, mirrored, flipped, and both - each quadrant meets its
  // neighbours along a mirror line, which is what makes the repeat seamless.
  for (const [fx, fy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    ctx.save();
    ctx.translate(fx < 0 ? w * 2 : 0, fy < 0 ? h * 2 : 0);
    ctx.scale(fx, fy);
    ctx.drawImage(frame, x, y, w, h, 0, 0, w, h);
    ctx.restore();
  }
  return tile;
}

export type DrawOptions = {
  /** Canvas px per artboard px. The export passes 1. */
  scale?: number;
};

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  layout: TitleLayout,
  paper: HTMLCanvasElement | null,
  options: DrawOptions = {},
): void {
  const { scale = 1 } = options;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
  if (!layout.lines.length) {
    ctx.restore();
    return;
  }

  // Into the banner's own frame: everything below is drawn flat and turned.
  ctx.translate(layout.pivot.x, layout.pivot.y);
  ctx.rotate(layout.angle);
  ctx.translate(-layout.pivot.x, -layout.pivot.y);

  const x0 = -BLEED;
  const y0 = -BLEED - layout.pivot.y;
  const w = CANVAS.w + BLEED * 2;
  const h = layout.bottom - y0;

  /* The navy goes down first, carrying the shadow; the paper goes over it with
   * none. A shadow cast by the pattern itself would be cast by every line of
   * every flower. The shadow is what lets the banner sit on any footage - on a
   * pale kitchen its bottom edge otherwise just stops. */
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 28 * scale;
  ctx.shadowOffsetY = 8 * scale;
  ctx.fillStyle = BANNER_NAVY;
  ctx.fillRect(x0, y0, w, h);
  ctx.restore();

  if (paper) {
    const pattern = ctx.createPattern(paper, "repeat");
    if (pattern) {
      /* Anchored so the tile's mirror line runs down the middle of the frame:
       * the pattern is then symmetrical about the title, which is centred. */
      const m = new DOMMatrix()
        .translateSelf(CANVAS.w / 2 - PAPER_CROP.w * PAPER_SCALE, 0)
        .scaleSelf(PAPER_SCALE, PAPER_SCALE);
      pattern.setTransform(m);
      ctx.fillStyle = pattern;
      ctx.fillRect(x0, y0, w, h);
    }
  }

  applyFont(ctx, layout.size, TRACKING);
  ctx.fillStyle = TYPE_INK;
  ctx.textBaseline = "alphabetic";
  /* Left-aligned from a computed start rather than textAlign centre: canvas adds
   * the letter-spacing after the last glyph too, so a centred line would sit
   * half a letter-space left of the middle. The widths in the layout already
   * leave that trailing space out. */
  ctx.textAlign = "left";
  for (const line of layout.lines) ctx.fillText(line.text, line.x - line.w / 2, line.y);

  ctx.restore();
}

/** The title laid out and drawn at full size, for download. */
export function renderFull(text: string, measure: Measure, paper: HTMLCanvasElement | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS.w;
  canvas.height = CANVAS.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  drawTitle(ctx, layoutTitle(text, measure), paper);
  return canvas;
}
