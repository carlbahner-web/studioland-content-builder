/* The social ad, as a starting arrangement.
 *
 * This is what used to be the template, and every line of the layout reasoning
 * below survived the roles being deleted - because the reasoning was never
 * about roles. It is about SHAPE: what a 1080x1080 needs that a 1200x630 does
 * not, where a headline can go once a character has claimed the right of a
 * landscape, how far a badge can sit before it fouls the copy.
 *
 * The difference is what it hands back. It used to draw five named elements
 * that no one could delete or restyle. It now returns ORDINARY LAYERS, and the
 * moment they exist nothing can tell they were composed rather than placed by
 * hand. You get the arrangement, and you keep every freedom.
 *
 * THE ONE THING THAT CHANGED IN SUBSTANCE: this runs when you ask, not on every
 * draw. Switching format no longer re-composes automatically. That sounds like
 * a loss and mostly is not - re-composition only ever applied to elements
 * nobody had touched, and the moment you moved one it kept its position across
 * formats anyway - but it is a real change and it is why "Standard arrangement"
 * exists as a button. Ask for it and this runs again for the shape you are in.
 *
 * The bible's flagship format (3.2): "full-bleed textured brand-color ground;
 * big DW-Fairfield headline (cream fill, charcoal outline for legibility)
 * stacked top; BUZZ in a matching mood in a lower corner; a CTA device
 * (starburst); wordmark in a corner."
 */
import { TRACKING, type Colorway, type Format } from "../brand.ts";
import { fitText, type TextStyle } from "../render.ts";
import { newImage, newShape, newText, type Layer } from "../layers.ts";
import type { LayerAssets } from "../drawLayers.ts";

export type StarterCopy = {
  headline: string;
  body: string;
  cta: string;
  /** Which BUZZ, or none at all. */
  buzz: string | null;
};

export const DEFAULT_COPY: StarterCopy = {
  headline: "Your mixes deserve a better client list",
  body: "StudioLand trains audio engineers to find and book the artists they actually want to work with.",
  cta: "Learn more",
  buzz: "brand:buzz-wave",
};

const DISPLAY: TextStyle = {
  family: "DWFairfield",
  tracking: TRACKING.display,
  lineHeight: 1.02,
  caps: true,
};

/* Compose the arrangement for one artboard.
 *
 * `measure` is a 2D context used only to fit the headline - the same autofit the
 * template ran, so the starting size still comes from how much room the copy
 * actually has rather than from a guess. Everything after that is a layer with
 * a concrete size you are free to change.
 *
 * The layout branches on SHAPE, never on a format's name, so a size added at
 * runtime composes correctly without anything being written for it.
 */
export function socialAdStarter(
  size: Format,
  cw: Colorway,
  assets: LayerAssets,
  measure: CanvasRenderingContext2D | null,
  copy: StarterCopy = DEFAULT_COPY,
): Layer[] {
  const { w, h } = size;
  const short = Math.min(w, h);
  const wide = w / h > 1.3;
  const veryTall = h / w > 1.5;
  const m = short * 0.075;
  const layers: Layer[] = [];

  /* --- BUZZ. First in the stack, so he sits behind the type. -------------- */
  const buzzImg = copy.buzz ? assets[copy.buzz] : undefined;
  let buzzLeft = w;
  let buzzTop = h;
  if (copy.buzz && buzzImg) {
    // A very tall artboard gives BUZZ proportionally less height, or he dominates it.
    const bh = wide ? h * 0.86 : h * (veryTall ? 0.3 : 0.36);
    const bw = (buzzImg.width / buzzImg.height) * bh;
    /* On a wide artboard BUZZ runs off the right edge on purpose, but the bleed
       is a fixed FRACTION OF HIM rather than of the artboard - otherwise how
       much of his hand is lost depends on how wide the format happens to be,
       and a 16:9 thumbnail crops him noticeably harder than a 1.9:1 link
       preview. Anchoring to his own width keeps the same deliberate sliver off
       every wide format. */
    const cx = wide ? w - bw * 0.44 : w * 0.72;
    const cy = (wide ? h * 1.02 : h - m * 0.4) - bh / 2;
    buzzLeft = cx - bw / 2;
    buzzTop = cy - bh / 2;
    layers.push(
      newImage(copy.buzz, "brand", {
        name: "BUZZ",
        x: cx / w,
        y: cy / h,
        w: bw / short,
      }),
    );
  }

  /* --- the wordmark, in a corner ------------------------------------------ */
  const markKey = cw.wordmark === "cream" ? "brand:wordmark-cream" : "brand:wordmark-charcoal";
  const markImg = assets[markKey];
  let markH = short * 0.08;
  if (markImg) {
    const markW = w * (wide ? 0.16 : 0.26);
    markH = (markImg.height / markImg.width) * markW;
    layers.push(
      newImage(markKey, "brand", {
        name: "Wordmark",
        x: (m + markW / 2) / w,
        y: (m + markH / 2) / h,
        w: markW / short,
      }),
    );
  }

  /* Clear space of at least the height of the "S" - which on this wordmark is
   * effectively its full height, since the S spans cap line to baseline. */
  const top = m + markH * (wide ? 1.5 : 1.9);

  /* --- the CTA badge, bottom left ----------------------------------------- */
  const hasCta = copy.cta.trim().length > 0;
  const r = hasCta ? (wide ? h * 0.13 : short * 0.125) : 0;
  const ctaTop = hasCta ? h - m - r * 2 : h;

  /* --- the type, in whatever is left -------------------------------------- */
  // Wide: the column stops short of BUZZ. Tall: it is full width, so it has to
  // clear BUZZ and the badge vertically instead.
  const colW = wide ? Math.max(w * 0.28, Math.min(w * 0.5, buzzLeft - m - w * 0.02)) : w - m * 2;
  /* In the tall sizes the badge sits on the floor at the left and the type has
   * to clear it. The landscape has no vertical room to spare, so there the badge
   * tucks into the RIGHT of the text column instead - between the copy and BUZZ
   * - and the type keeps the full height. Stacking it under the copy in a 630px
   * banner squeezed the supporting line to an unreadable sliver. */
  const textBottom = wide ? h - m : Math.min(buzzTop - m * 0.3, ctaTop - m * 0.4);
  const textH = Math.max(textBottom - top, h * 0.12);

  /* The headline is FITTED, once, here - the same autofit the template ran on
     every draw. Doing it at compose time rather than at draw time is the whole
     change: the size it works out becomes an ordinary number on an ordinary
     layer, which you can then override, and which stops moving under you while
     you type into it. */
  const headMax = h * 0.22;
  let headSize = headMax;
  let headHeight = headMax;
  if (measure) {
    const fitted = fitText(
      measure,
      copy.headline,
      DISPLAY,
      colW,
      textH * (wide ? 0.55 : 0.66),
      headMax,
    );
    headSize = fitted.size;
    headHeight = fitted.height;
  }
  layers.push(
    newText({
      name: "Headline",
      text: copy.headline,
      face: "display",
      caps: true,
      balance: true,
      color: cw.ink,
      outline: cw.outline,
      w: colW / short,
      size: headSize / short,
      x: (m + colW / 2) / w,
      y: (top + headHeight / 2) / h,
    }),
  );

  if (copy.body.trim()) {
    const bodyTop = top + headHeight + m * 0.42;
    // The landscape body stops short of the badge parked at the column's right.
    const bodyW = wide ? colW - r * 2 - m * 0.5 : colW * 0.94;
    const bodyMax = h * 0.034;
    let bodySize = bodyMax;
    let bodyHeight = bodyMax;
    if (measure) {
      const fitted = fitText(
        measure,
        copy.body,
        { family: "TAYWingman", tracking: TRACKING.body, lineHeight: 1.82 },
        bodyW,
        Math.max(textBottom - bodyTop, h * 0.04),
        bodyMax,
      );
      bodySize = fitted.size;
      bodyHeight = fitted.height;
    }
    layers.push(
      newText({
        name: "Supporting line",
        text: copy.body,
        face: "body",
        caps: false,
        color: cw.ink,
        w: bodyW / short,
        size: bodySize / short,
        x: (m + bodyW / 2) / w,
        y: (bodyTop + bodyHeight / 2) / h,
      }),
    );
  }

  if (hasCta) {
    layers.push(
      newShape("starburst", {
        name: "Call to action",
        label: copy.cta,
        fill: cw.ctas[0],
        stroke: null,
        x: (wide ? m + colW - r : m + r) / w,
        y: (h - m - r) / h,
        w: (r * 2) / short,
        h: (r * 2) / short,
      }),
    );
  }

  return layers;
}
