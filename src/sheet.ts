/* The sheet: a ground, a stack of layers, and the paper over the top.
 *
 * This is the whole of what a design is now, and the shortness of the file is
 * the point. It used to be a 500-line template that owned five named elements -
 * it knew the headline went above the supporting line, that BUZZ claimed the
 * right of a landscape, that the badge tucked between them - and drew each from
 * its own branch, with per-format zone maths deciding where everything landed.
 *
 * That composition was not thrown away, it MOVED: `starters/` still knows all
 * of it, and hands back the same arrangement as ordinary layers. The difference
 * is that it is now something you ask for rather than something you are inside.
 * A design that has been composed is indistinguishable from one built by hand,
 * which is what lets every element be deleted, restyled and given its own paper
 * without a single exception in the drawing code.
 *
 * What is left here is genuinely common to every asset: what the ground is, what
 * order things stack in, where the paper goes, and how a video's curtain pulls
 * across. Nothing in this file knows what any layer is FOR.
 */
import { PALETTE, inkFor, type Colorway, type Format } from "./brand.ts";
import { drawCurtain, setBoilFrame, setInk, setInkMode, stageScale, type InkMode } from "./boil.ts";
import { drawGrain, grainMasked, GRAIN_ALPHA } from "./render.ts";
import { drawLayers, type LayerAssets } from "./drawLayers.ts";
import type { Layer } from "./layers.ts";

/** A grabbable thing on the artboard, in device pixels. */
export type Region = {
  id: string;
  label: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation?: number;
};

export type Assets = {
  /** Every decoded image, by key: brand artwork, folder files and uploads. */
  images: LayerAssets;
};

export type Design = {
  layers: Layer[];
};

/* 180 frames at 30fps = 6.0s. A multiple of the boil's 12-frame cycle, so the
 * wobble lands on the same phase at the loop point instead of jumping. */
export const LOOP_FRAMES = 180;
/** The curtain's pull, each end. 18 frames = 0.6s. */
const WIPE_FRAMES = 18;

/* Frame f's curtain position, 0 covered to 1 gone. The reveal runs at the head
 * and the cover runs at the tail IN THE SAME DIRECTION, so the last frame is
 * exactly one frame's travel short of the first and the loop is seamless. A
 * wipe that came back the other way would read as a loading bar - the bible
 * rules that out explicitly. */
function curtainAt(frame: number): number {
  if (frame < WIPE_FRAMES) return frame / WIPE_FRAMES;
  if (frame >= LOOP_FRAMES - WIPE_FRAMES) {
    return 1 - (frame - (LOOP_FRAMES - WIPE_FRAMES)) / WIPE_FRAMES;
  }
  return 1;
}

function hit(r: Region, px: number, py: number): boolean {
  const a = (-(r.rotation ?? 0) * Math.PI) / 180;
  const dx = px - r.cx;
  const dy = py - r.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.h / 2;
}

/** Topmost region under a point. Regions come back in draw order, so search back. */
export function hitRegion(regions: Region[], px: number, py: number): Region | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    if (hit(regions[i], px, py)) return regions[i];
  }
  return null;
}

export type RenderOpts = {
  /** null renders the still. A frame index renders that frame of the loop. */
  frame?: number | null;
  /** off | still | live. See boil.ts - a still is one held phase, not "no boil". */
  ink?: InkMode;
  curtain?: boolean;
  /** One layer to leave undrawn, while its text is being typed on the artboard. */
  hide?: string | null;
  /** Leave the ground unpainted, so the export carries real alpha. */
  transparent?: boolean;
  /** The sheet's grain strength. See GRAIN_ALPHA in render.ts. */
  grain?: number;
};

export function drawSheet(
  ctx: CanvasRenderingContext2D,
  size: Format,
  cw: Colorway,
  design: Design,
  assets: Assets,
  opts: RenderOpts = {},
): Region[] {
  const {
    frame = null,
    ink: inkMode = "still",
    curtain = true,
    hide = null,
    transparent = false,
    grain = GRAIN_ALPHA,
  } = opts;
  const { w, h } = size;
  const S = stageScale(w, h);

  setInkMode(inkMode);
  setBoilFrame(frame, S);
  setInk(0);

  const ground = PALETTE[cw.ground];
  const ink = PALETTE[inkFor(ground)];

  ctx.clearRect(0, 0, w, h);
  if (!transparent) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
  }

  const layerOpts = { ink: inkMode, frame, scale: S, defaultInk: ink };
  const regions = drawLayers(ctx, size, design.layers, assets.images, { ...layerOpts, hide });

  /* --- the paper, over everything ---------------------------------------- */
  drawGrain(ctx, w, h, transparent, grain);

  /* --- and then the two exceptions to "everything" ------------------------ */

  /* A layer that wants NO paper is simply drawn again, on top of the grain.
   *
   * That is exact for any shape - a cut-out subject, a rotated ellipse, the
   * counters inside a letterform - because it is the same drawing code with the
   * same inputs, so the pixels land identically. Excluding a bounding box from
   * the grain instead would have taken the paper off the ground around the
   * element too, leaving a clean rectangle in the middle of a printed sheet. */
  const crisp = design.layers.filter((l) => !l.hidden && l.grain === "none" && l.id !== hide);
  if (crisp.length) drawLayers(ctx, size, crisp, assets.images, layerOpts);

  /* A layer that wants MORE gets a second pass of the same sheet, shaped by
     what it actually drew rather than by its box. */
  const heavy = design.layers.filter((l) => !l.hidden && l.grain === "extra" && l.id !== hide);
  for (const l of heavy) {
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d");
    if (!mctx) continue;
    drawLayers(mctx, size, [l], assets.images, layerOpts);
    grainMasked(ctx, w, h, mask, grain);
  }

  /* --- and the curtain over that ------------------------------------------ */
  if (frame !== null && curtain) {
    // Charcoal, except on the charcoal ground where it would be invisible -
    // the boil lives in the edge contrast.
    const cloth = cw.ground === "charcoal" ? PALETTE.offwhite : PALETTE.charcoal;
    setInkMode(inkMode);
    setBoilFrame(frame, S);
    drawCurtain(ctx, w, h, curtainAt(frame), cloth);
  }

  return regions;
}
