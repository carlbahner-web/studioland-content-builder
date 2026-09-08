/* Drawing the layers you added, over the design the template composed.
 *
 * This is deliberately a separate file from the template. A template is a
 * COMPOSITION - it knows that the headline goes above the supporting line and
 * that BUZZ claims the right of a landscape - and there will be more of them
 * (the carousel, the reel word-card, the EDU title slide). Layers are not part
 * of any of that: they sit over whatever was composed, in the order you stacked
 * them, and every template gets them for free by calling this.
 *
 * What follows the brand's rules rather than the user's choice:
 *
 *  - TEXT NEVER BOILS. The rule is absolute, so a text layer has no ink control
 *    at all rather than one that does nothing.
 *  - DRAWN SHAPES DO boil. They are linework, and linework here is drawn by
 *    hand, so they take Recipe B through the same context proxy the starburst
 *    uses.
 *  - ARTWORK NEVER WARPS. "The linework IS the drawing", so an image layer is
 *    drawn exactly as painted and a misregistered silhouette behind it carries
 *    the motion - the same treatment BUZZ gets.
 */
import { PALETTE } from "./brand.ts";
import {
  BOIL,
  inkCtx,
  misregOffset,
  setBoilFrame,
  setInk,
  setInkMode,
  type InkMode,
} from "./boil.ts";
import {
  drawLines,
  drawStarburst,
  ellipsePath,
  layoutText,
  measureLines,
  rectPath,
  silhouetteOf,
  type TextStyle,
} from "./render.ts";
import { colorOf, faceOf, type Layer, type TextLayer } from "./layers.ts";
import type { Format } from "./brand.ts";

/** A grabbable thing on the artboard, in device pixels. Mirrors the template's. */
export type LayerRegion = {
  id: string;
  label: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation?: number;
};

export type LayerAssets = Record<string, HTMLImageElement>;

export type LayerDrawOpts = {
  /** The design's ink mode. A layer's own setting overrides it. */
  ink: InkMode;
  /** null renders the still; a frame index renders that frame of the loop. */
  frame: number | null;
  /** Stage scale, from stageScale(). */
  scale: number;
  /** Ink to use where a text layer asked for the ground's opposite. */
  defaultInk: string;
  /** One layer to leave undrawn - see RenderOpts.hide. It still reports its
   *  region, so it stays selectable while it is being typed into. */
  hide?: string | null;
};

const styleOf = (l: TextLayer): TextStyle => {
  const face = faceOf(l.face);
  return {
    family: face.family,
    tracking: face.tracking,
    lineHeight: face.lineHeight,
    caps: l.caps,
  };
};

/* A text layer's box, which the layout has to work out before it can be drawn
 * OR hit-tested. Exported because the artboard needs the same answer when
 * nothing has been drawn yet - a layer added while the preview is mid-frame
 * still has to be selectable. */
export function textBox(
  ctx: CanvasRenderingContext2D,
  size: Format,
  l: TextLayer,
): { w: number; h: number } {
  const short = Math.min(size.w, size.h);
  const boxW = l.w * short;
  const fitted = layoutText(ctx, l.text, styleOf(l), boxW, l.size * short, l.balance);
  // The BOX is as wide as you set it; the region is only as wide as the text
  // actually runs, so grabbing a short centred line does not mean grabbing a
  // stretch of empty artboard beside it.
  const inkW = Math.min(boxW, measureLines(ctx, fitted, styleOf(l)));
  return { w: Math.max(inkW, short * 0.02), h: Math.max(fitted.height, short * 0.02) };
}

/** The box a layer occupies, in device pixels. */
export function layerBox(
  ctx: CanvasRenderingContext2D,
  size: Format,
  l: Layer,
  assets: LayerAssets,
): { cx: number; cy: number; w: number; h: number } | null {
  const short = Math.min(size.w, size.h);
  const cx = l.x * size.w;
  const cy = l.y * size.h;
  if (l.kind === "text") return { cx, cy, ...textBox(ctx, size, l) };
  if (l.kind === "shape") {
    // A rule has no height to speak of, so its grab box is its stroke at least.
    const h = l.shape === "line" ? Math.max(l.h, l.strokeWidth * 1.6) : l.h;
    return { cx, cy, w: l.w * short, h: h * short };
  }
  const img = assets[l.file];
  if (!img) return null;
  const w = l.w * short;
  // A framed image is the size of its frame; an unframed one is the size of
  // the artwork.
  return { cx, cy, w, h: l.frameH === null ? (img.height / img.width) * w : l.frameH * short };
}

/* Where the artwork sits inside its frame, in the frame's own coordinates
 * (0,0 at the centre).
 *
 * The artwork is scaled to COVER the frame and then offset so that the focal
 * point lands in the middle - and then that offset is CLAMPED so the frame
 * stays covered. Without the clamp, dragging the focus to a corner slides the
 * artwork off its own frame and leaves a band of ground showing through, which
 * is never what a crop is for: a crop says "this rectangle is filled". */
export function coverBox(
  img: { width: number; height: number },
  frameW: number,
  frameH: number,
  zoom: number,
  focusX: number,
  focusY: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(frameW / img.width, frameH / img.height) * Math.max(1, zoom);
  const w = img.width * scale;
  const h = img.height * scale;
  const limitX = Math.max(0, (w - frameW) / 2);
  const limitY = Math.max(0, (h - frameH) / 2);
  const wantX = w * (0.5 - focusX);
  const wantY = h * (0.5 - focusY);
  const cx = Math.min(limitX, Math.max(-limitX, wantX));
  const cy = Math.min(limitY, Math.max(-limitY, wantY));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* Draw the whole stack, bottom to top, and report where everything landed.
 *
 * Regions come back from the DRAW rather than from a second pass, which is the
 * same rule the template follows: hit-testing against a recomputed copy of the
 * layout maths is how the two silently drift apart. */
export function drawLayers(
  ctx: CanvasRenderingContext2D,
  size: Format,
  layers: Layer[],
  assets: LayerAssets,
  opts: LayerDrawOpts,
): LayerRegion[] {
  const short = Math.min(size.w, size.h);
  const regions: LayerRegion[] = [];

  for (const l of layers) {
    if (l.hidden) continue;
    if (l.id === opts.hide) {
      const box = layerBox(ctx, size, l, assets);
      if (box) regions.push({ id: l.id, label: l.name, ...box, rotation: l.rotation });
      continue;
    }
    const box = layerBox(ctx, size, l, assets);
    if (!box) continue;
    const { cx, cy, w, h } = box;
    regions.push({ id: l.id, label: l.name, cx, cy, w, h, rotation: l.rotation });

    /* Ink is resolved per layer, and both the mode AND the phase have to be
       re-set before each one: the still phase and the live phase are chosen by
       the mode, so setting one without the other leaves the previous layer's
       clock in place. */
    const mode = l.ink ?? opts.ink;
    setInkMode(mode);
    setBoilFrame(opts.frame, opts.scale);
    const inked = mode !== "off";

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
    ctx.translate(cx, cy);
    ctx.rotate((l.rotation * Math.PI) / 180);

    if (l.kind === "text") {
      // No ink path at all. Text never boils.
      setInk(0);
      const style = styleOf(l);
      const boxW = l.w * short;
      const fitted = layoutText(ctx, l.text, style, boxW, l.size * short, l.balance);
      // drawLines takes the origin its alignment measures from.
      const originX = l.align === "left" ? -w / 2 : l.align === "right" ? w / 2 : 0;
      drawLines(ctx, fitted, style, originX, -fitted.height / 2, {
        fill: colorOf(l.color, PALETTE.offwhite) ?? PALETTE.offwhite,
        outline: colorOf(l.outline),
        outlineWidth: 0.055,
        align: l.align === "center" ? "center" : l.align === "right" ? "right" : "left",
      });
    } else if (l.kind === "shape") {
      const path = inked ? inkCtx(ctx) : ctx;
      setInk(inked ? BOIL.shape : 0);
      const fill = colorOf(l.fill);
      const stroke = colorOf(l.stroke);
      const lw = l.strokeWidth * short;

      if (l.shape === "starburst") {
        // The brand's own device, placeable. Its label goes through the plain
        // context inside drawStarburst, because text never boils.
        setInk(inked ? BOIL.starburst : 0);
        drawStarburst(
          ctx,
          path,
          0,
          0,
          Math.min(w, h) / 2,
          l.label,
          fill ?? PALETTE.mustard,
          stroke ?? opts.defaultInk,
        );
      } else if (l.shape === "line") {
        path.beginPath();
        path.moveTo(-w / 2, 0);
        path.lineTo(w / 2, 0);
        path.lineCap = "round";
        path.lineWidth = Math.max(1, lw);
        path.strokeStyle = stroke ?? opts.defaultInk;
        path.stroke();
      } else {
        if (l.shape === "rect") rectPath(path, -w / 2, -h / 2, w, h, l.radius * Math.min(w, h));
        else ellipsePath(path, 0, 0, w / 2, h / 2);
        if (fill) {
          path.fillStyle = fill;
          path.fill();
        }
        if (stroke && lw > 0) {
          path.lineJoin = "round";
          path.lineWidth = Math.max(1, lw);
          path.strokeStyle = stroke;
          path.stroke();
        }
      }
      setInk(0);
    } else {
      const img = assets[l.file];
      if (img) {
        /* A frame CLIPS. Everything inside this block - the silhouette as much
           as the artwork - is bounded by it, or the misregistered edge would
           spill out past the crop and give the frame a soft charcoal halo on
           the sides the artwork was cut off at. */
        const framed = l.frameH !== null;
        const at = framed
          ? coverBox(img, w, h, l.zoom, l.focusX, l.focusY)
          : { x: -w / 2, y: -h / 2, w, h };
        if (framed) {
          ctx.beginPath();
          ctx.rect(-w / 2, -h / 2, w, h);
          ctx.clip();
        }
        /* Flipping is a transform on the drawing, never on the silhouette's
           offset: the misregistration is a property of the press, so it does
           not mirror when the artwork does. */
        if (inked) {
          const sil = silhouetteOf(img, PALETTE.charcoal);
          const { dx, dy } = misregOffset(opts.scale);
          if (sil) {
            ctx.globalAlpha *= 0.75;
            ctx.drawImage(sil, at.x + dx, at.y + dy, at.w, at.h);
            ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
          }
        }
        setInk(0);
        ctx.save();
        ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
        ctx.drawImage(img, at.x, at.y, at.w, at.h);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  setInk(0);
  return regions;
}
