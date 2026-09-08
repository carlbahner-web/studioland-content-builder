/* Canvas drawing primitives for the generator.
 *
 * WHY CANVAS RATHER THAN DOM-TO-IMAGE. The obvious build is to lay a template
 * out in HTML and rasterise it, which is roughly what the Kit tool appears to
 * do. Three things about StudioLand's brand push the other way:
 *
 *  1. The grain is a MULTIPLY composite over the whole field. In canvas that is
 *     one line. Through foreignObject rasterisation, mix-blend-mode support is
 *     inconsistent and silently degrades to normal - which the bible measured at
 *     a 43% saturation loss on teal. A texture bug you cannot see in the preview
 *     but that ships in the export is the worst possible failure here.
 *  2. The boil is an SVG filter (feTurbulence + feDisplacementMap). Filters do
 *     not survive foreignObject rasterisation reliably. wild-ride already has a
 *     canvas boil (Recipe B) written and debugged, so canvas is where the
 *     signature motion can actually be reproduced.
 *  3. Animated export means drawing frames. A canvas renderer is already a frame
 *     renderer; a DOM one has to be rebuilt as a canvas renderer to get there.
 *
 * The cost is that text layout - wrapping, balancing, autofitting - has to be
 * written rather than inherited from CSS. That is the code below.
 */

import { assetUrl } from "./assets.ts";

/* -------------------------------------------------------------- asset loading */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/** The two brand faces. Nothing renders until these resolve. */
export async function loadBrandFonts(): Promise<void> {
  const faces: [string, string][] = [
    ["DWFairfield", "/fonts/DWFairfield.woff2"],
    ["DWFairfieldNarrow", "/fonts/DWFairfield-Narrow.woff2"],
    ["TAYWingman", "/fonts/TAYWingman.woff2"],
  ];
  await Promise.all(
    faces.map(async ([family, url]) => {
      const face = new FontFace(family, `url(${assetUrl(url)}) format("woff2")`);
      await face.load();
      document.fonts.add(face);
    }),
  );
}

/* ------------------------------------------------------------------- the grain */

/* The bible forbids scaling a texture at paint time: resample once to the size
 * it will be used at, then apply 1:1. Paint-time scaling aliases (which reads as
 * pixelation) and costs more. So the 512px source is resampled into a 256px tile
 * exactly once, and the pattern below is drawn at identity. */
let grainTile: HTMLCanvasElement | null = null;

export function prepareGrain(src: HTMLImageElement): void {
  if (grainTile) return;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context for the grain tile");
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, 256, 256);
  grainTile = c;
}

/** The press grain, over everything. Multiply at 0.2 - the game's measured recipe. */
export function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (!grainTile) return;
  const pat = ctx.createPattern(grainTile, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* -------------------------------------------------------------- text layout */

const HAS_LETTER_SPACING = (() => {
  try {
    const c = document.createElement("canvas").getContext("2d");
    return !!c && "letterSpacing" in c;
  } catch {
    return false;
  }
})();

export type TextStyle = {
  family: string;
  /** Tracking in em, from TRACKING in brand.ts. */
  tracking: number;
  lineHeight: number;
  caps?: boolean;
};

function applyFont(ctx: CanvasRenderingContext2D, style: TextStyle, size: number): void {
  ctx.font = `${size}px "${style.family}", sans-serif`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${style.tracking * size}px`;
}

/** Greedy wrap, honouring explicit newlines. */
function wrapAt(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (ctx.measureText(next).width <= maxW) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/* Balanced wrap - our text-wrap: balance.
 *
 * This exists because of an observation about the Kit tool this was modelled on:
 * a headline that breaks with one orphaned word looks unfinished, and the fix a
 * designer would reach for by hand (nudge the break) does not survive being
 * re-used at another aspect ratio. Balancing does survive, because it is recomputed per size: the
 * same headline can sit on two even lines in a square and one line in a
 * landscape without anyone touching it.
 *
 * Method: greedy-wrap to find how few lines the text needs, then binary-search
 * the NARROWEST width that still needs only that many lines. Squeezing the box
 * without adding a line is what pulls the last line up level with the rest.
 */
export function balancedWrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const target = wrapAt(ctx, text, maxW);
  if (target.length <= 1) return target;
  let lo = 0;
  let hi = maxW;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (wrapAt(ctx, text, mid).length <= target.length) hi = mid;
    else lo = mid;
  }
  return wrapAt(ctx, text, hi);
}

export type FittedText = {
  lines: string[];
  size: number;
  lineHeight: number;
  height: number;
};

/** Largest font size at which `text` fits `maxW` x `maxH`, wrapped and balanced. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  maxW: number,
  maxH: number,
  maxSize: number,
  minSize = 8,
): FittedText {
  const body = style.caps ? text.toUpperCase() : text;
  let lo = minSize;
  let hi = maxSize;
  let best: FittedText = { lines: [body], size: minSize, lineHeight: minSize, height: minSize };
  for (let i = 0; i < 22; i++) {
    const size = (lo + hi) / 2;
    applyFont(ctx, style, size);
    const lines = balancedWrap(ctx, body, maxW);
    const lineHeight = size * style.lineHeight;
    const height = lineHeight * lines.length;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (height <= maxH && widest <= maxW) {
      best = { lines, size, lineHeight, height };
      lo = size;
    } else hi = size;
  }
  applyFont(ctx, style, best.size);
  return best;
}

/* Lay text out AT A GIVEN SIZE, wrapping to a width - the free text box's
 * counterpart to fitText.
 *
 * fitText answers "how big can this be in the space the layout left", which is
 * what a template slot needs. A layer is not in a slot: you chose its size and
 * its width, so the size is honoured and the height is whatever the wrap comes
 * to. Balancing is offered rather than assumed, because on a box you sized
 * yourself an even rag is a preference and not a rescue.
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  maxW: number,
  size: number,
  balance = false,
): FittedText {
  const body = style.caps ? text.toUpperCase() : text;
  applyFont(ctx, style, size);
  const lines = balance ? balancedWrap(ctx, body, maxW) : wrapAt(ctx, body, maxW);
  const lineHeight = size * style.lineHeight;
  return { lines, size, lineHeight, height: lineHeight * lines.length };
}

/** The widest line, at the size the text was laid out. */
export function measureLines(
  ctx: CanvasRenderingContext2D,
  fitted: FittedText,
  style: TextStyle,
): number {
  applyFont(ctx, style, fitted.size);
  return Math.max(0, ...fitted.lines.map((l) => ctx.measureText(l).width));
}

export type DrawTextOpts = {
  fill: string;
  /** Outline color, or null for none. */
  outline?: string | null;
  /** Outline weight as a fraction of font size. */
  outlineWidth?: number;
  align?: CanvasTextAlign;
};

/** Draw fitted lines from a top-left (or top-centre) origin. */
export function drawLines(
  ctx: CanvasRenderingContext2D,
  fitted: FittedText,
  style: TextStyle,
  x: number,
  y: number,
  opts: DrawTextOpts,
): void {
  applyFont(ctx, style, fitted.size);
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  fitted.lines.forEach((line, i) => {
    // Sit the first line's baseline inside the box rather than on its top edge.
    const by = y + fitted.lineHeight * (i + 0.78);
    if (opts.outline) {
      ctx.strokeStyle = opts.outline;
      ctx.lineWidth = fitted.size * (opts.outlineWidth ?? 0.06);
      ctx.strokeText(line, x, by);
    }
    ctx.fillStyle = opts.fill;
    ctx.fillText(line, x, by);
  });
}

/* -------------------------------------------------------------- the starburst */

/* A deterministic wobble, so a given badge looks hand-cut but redraws
 * identically. Templates must be pure functions of their input: the same
 * content at the same size has to export byte-identically every time, or
 * "download all" produces a set that does not match the previews. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* A charcoal silhouette of a bitmap, cached per image.
 *
 * This is how finished artwork joins the motion without being touched. The
 * bible: "The artwork itself never warps. Bitmap art (BUZZ, Donk, any finished
 * illustration) gets a boiling charcoal silhouette behind it; the drawing stays
 * untouched. Warping real art softens the linework, and the linework IS the
 * drawing." So BUZZ is drawn exactly as painted, and it is his shadow that
 * breathes - the print-misregistration cycle from 2.1, live rather than static.
 */
const silhouettes = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

export function silhouetteOf(img: HTMLImageElement, color: string): HTMLCanvasElement | null {
  const hit = silhouettes.get(img);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0);
  // Keep the alpha, replace every colour with the ink.
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  silhouettes.set(img, c);
  return c;
}

/** The spiky CTA badge: brand-color fill, contrasting ink, label in caps.
 *
 * `path` is the context the SHAPE is drawn through - a boiled one when
 * animating. The label is always drawn through `ctx`, because text never boils. */
export function drawStarburst(
  ctx: CanvasRenderingContext2D,
  path: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  label: string,
  fill: string,
  ink: string,
): void {
  const points = 16;
  const rand = seeded(label.length * 7919 + points);
  ctx.save();
  path.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const outer = i % 2 === 0;
    // The jitter is what keeps it from reading as a stock CSS star.
    const r = radius * (outer ? 1 : 0.76) * (0.94 + rand() * 0.12);
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  path.fillStyle = fill;
  path.fill();
  path.lineJoin = "round";
  path.lineWidth = radius * 0.055;
  path.strokeStyle = ink;
  path.stroke();

  const style: TextStyle = { family: "DWFairfield", tracking: 0.06, lineHeight: 1.05, caps: true };
  const fitted = fitText(ctx, label, style, radius * 1.32, radius * 0.95, radius * 0.42);
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  applyFont(ctx, style, fitted.size);
  fitted.lines.forEach((line, i) => {
    const oy = (i - (fitted.lines.length - 1) / 2) * fitted.lineHeight;
    ctx.fillText(line, cx, cy + oy + fitted.size * 0.34);
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ shapes */

/* Every path below is built from moveTo/lineTo/arc ONLY, and that is not an
 * accident. Those are the calls the boil's context proxy overrides, so a shape
 * drawn this way boils - it is linework, and linework in this brand is drawn by
 * hand. Reaching for the canvas's own `roundRect` or `ellipse` would emit a path
 * the proxy never sees, and the shape would come out machine-perfect while
 * everything beside it wobbled. */

/** A rectangle, optionally with rounded corners, as a boilable path. */
export function rectPath(
  path: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 0,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  path.beginPath();
  if (r <= 0) {
    path.moveTo(x, y);
    path.lineTo(x + w, y);
    path.lineTo(x + w, y + h);
    path.lineTo(x, y + h);
    path.closePath();
    return;
  }
  const HALF = Math.PI / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.arc(x + w - r, y + r, r, -HALF, 0);
  path.lineTo(x + w, y + h - r);
  path.arc(x + w - r, y + h - r, r, 0, HALF);
  path.lineTo(x + r, y + h);
  path.arc(x + r, y + h - r, r, HALF, Math.PI);
  path.lineTo(x, y + r);
  path.arc(x + r, y + r, r, Math.PI, Math.PI + HALF);
  path.closePath();
}

/** An ellipse as a boilable path. Sampled rather than drawn with `ellipse`,
 *  which the boil's proxy does not intercept - see above. */
export function ellipsePath(
  path: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const steps = 72;
  path.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = cx + Math.cos(a) * rx;
    const py = cy + Math.sin(a) * ry;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
}

/** Draw an image scaled to a box height, anchored by its bottom edge. */
export function drawImageByHeight(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  height: number,
  cx: number,
  bottom: number,
): void {
  const w = (img.width / img.height) * height;
  ctx.drawImage(img, cx - w / 2, bottom - height, w, height);
}
