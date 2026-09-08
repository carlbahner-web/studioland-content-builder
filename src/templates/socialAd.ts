/* The social ad.
 *
 * The bible's flagship format (3.2): "full-bleed textured brand-color ground;
 * big DW-Fairfield headline (cream fill, charcoal outline for legibility)
 * stacked top; BUZZ in a matching mood in a lower corner; a CTA device
 * (starburst); wordmark in a corner."
 *
 * Landscape is composed separately rather than scaled down from the square. A
 * 1200x630 is a fundamentally different shape - stacking a headline over a
 * character in it leaves both cramped - so there the headline takes the left
 * and BUZZ takes the right. This is the same reason the Kit tool draws its
 * landscape differently: a scaled square is not a landscape design.
 */
import {
  PALETTE,
  TRACKING,
  LEADING_BODY,
  inkFor,
  type BuzzPose,
  type Colorway,
  type Format,
} from "../brand.ts";
import {
  BOIL,
  drawCurtain,
  inkCtx,
  misregOffset,
  setBoilFrame,
  setInk,
  setInkMode,
  stageScale,
  type InkMode,
} from "../boil.ts";
import {
  drawGrain,
  drawImageByHeight,
  drawLines,
  drawStarburst,
  fitText,
  silhouetteOf,
  type TextStyle,
} from "../render.ts";
import { drawLayers, type LayerAssets } from "../drawLayers.ts";
import type { Layer } from "../layers.ts";

/* Ids for the things the layout places itself. A layer uses its own id. */
export const PLACED = ["headline", "body", "cta", "buzz", "wordmark"] as const;
export type PlacedId = (typeof PLACED)[number];

export type SocialAdContent = {
  headline: string;
  body: string;
  cta: string;
  buzz: BuzzPose;
  /* What you added, over what the template composed. Drawn bottom to top in
   * this order, above the design and below the grain. See layers.ts. */
  layers: Layer[];
  /* Where each element actually sits. Every field is optional and every one
   * that is absent falls back to what the layout chose for this format.
   *
   * This is ABSOLUTE placement, and that is a reversal. The layout used to be a
   * cage: elements could only be nudged off it, so that switching format
   * re-flowed everything and nothing could be put somewhere daft. That is the
   * right design for a self-service tool used by people who are not designers -
   * it is what stops a teammate making a mess. This tool has one user and he is
   * the designer, so the constraint was protecting against a risk that does not
   * exist while getting in the way of the work that does.
   *
   * The layout did not go away, it changed job: it is now the DEFAULT
   * arrangement rather than the only one. An untouched element still composes
   * itself per format, "Auto-arrange" puts everything back, and a preset stores
   * an arrangement you liked. What you move stays where you put it. */
  transforms: Partial<
    Record<string, { x?: number; y?: number; scale?: number; rotation?: number }>
  >;
  /* Per-element ink, overriding the global default. Text is absent on purpose -
   * text never boils, so there is nothing to toggle. */
  inkOverrides: Partial<Record<string, InkMode>>;
};

/* The wordmark has a floor. The bible sets a minimum size "so the arrow-I
 * signpost stops reading" - roughly 140px on screen. An exported artboard is
 * viewed at all sorts of sizes, so a literal pixel figure would be false
 * precision; a proportion of the artboard holds at any of them. Below about an
 * eighth of the width the signpost stops being legible on a phone, so the size
 * control cannot go under it. */
const MARK_MIN_FRACTION = 0.12;

export function minMarkScale(size: Format): number {
  const base = size.w / size.h > 1.3 ? 0.16 : 0.26;
  return Math.round((MARK_MIN_FRACTION / base) * 100) / 100;
}

/** A grabbable thing on the artboard, in device pixels. */
export type Region = {
  id: string;
  label: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Stickers can rotate; everything else is axis-aligned. */
  rotation?: number;
};

export type Assets = {
  buzz: Partial<Record<BuzzPose, HTMLImageElement>>;
  wordmark: { cream: HTMLImageElement; charcoal: HTMLImageElement };
  /** Decoded images for image layers, by name. Missing ones are skipped. */
  images: LayerAssets;
};

const DISPLAY: TextStyle = {
  family: "DWFairfield",
  tracking: TRACKING.display,
  lineHeight: 1.02,
  caps: true,
};

const BODY: TextStyle = {
  family: "TAYWingman",
  tracking: TRACKING.body,
  lineHeight: LEADING_BODY,
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
  const a = ((-(r.rotation ?? 0) * Math.PI) / 180) as number;
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
  /* One layer to leave undrawn. Used while its text is being typed on the
   * artboard, so the canvas copy and the caret do not sit on top of each other.
   * The export path never sets it - it is an editing state, not a property of
   * the design. */
  hide?: string | null;
  /* Leave the ground unpainted, so the export carries real alpha. The colourway
   * still decides ink and outline colours - you are choosing what the asset is
   * FOR, and only declining to paint the field behind it. */
  transparent?: boolean;
};

export function drawSocialAd(
  ctx: CanvasRenderingContext2D,
  size: Format,
  cw: Colorway,
  content: SocialAdContent,
  assets: Assets,
  opts: RenderOpts = {},
): Region[] {
  const {
    frame = null,
    ink: inkMode = "still",
    curtain = true,
    hide = null,
    transparent = false,
  } = opts;
  const { w, h } = size;
  const S = stageScale(w, h);
  const regions: Region[] = [];

  /* Ink is resolved PER ELEMENT: the global mode is the default and anything
   * with its own setting overrides it. Both the mode and the phase have to be
   * re-set before each element, because the still phase and the live phase are
   * chosen by the mode. */
  const useInk = (id: string): boolean => {
    const m = content.inkOverrides[id] ?? inkMode;
    setInkMode(m);
    setBoilFrame(frame, S);
    return m !== "off";
  };

  /** Where an element ended up, after the layout and then the nudge. */
  /* Where an element goes: its own transform where it has one, otherwise
   * whatever the layout worked out for this format. */
  const place = (id: string, defCx: number, defCy: number) => {
    const tr = content.transforms[id] ?? {};
    return {
      cx: tr.x === undefined ? defCx : tr.x * w,
      cy: tr.y === undefined ? defCy : tr.y * h,
      scale: tr.scale ?? 1,
      rotation: ((tr.rotation ?? 0) * Math.PI) / 180,
    };
  };

  const scaleOf = (id: string) => content.transforms[id]?.scale ?? 1;

  /** Draw something centred, rotated about its own middle. */
  const at = (cx: number, cy: number, rotation: number, draw: () => void) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
    draw();
    ctx.restore();
  };

  setInkMode(inkMode);
  setBoilFrame(frame, S);
  setInk(0);
  /* The layout branches on SHAPE, never on a format's name, so a format added
     to the list composes correctly without touching this file. */
  const wide = w / h > 1.3;
  const veryTall = h / w > 1.5;
  const m = Math.min(w, h) * 0.075;
  const ground = PALETTE[cw.ground];
  const ink = PALETTE[inkFor(ground)];

  ctx.clearRect(0, 0, w, h);
  if (!transparent) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);
  }

  /* Layout is zones, not a free-floating stack.
   *
   * The first pass let each block size itself and place itself, which looked
   * right in the portrait and fell apart everywhere else: the supporting line
   * ran under BUZZ in the square, and in the landscape it went under both BUZZ
   * and the starburst. Autofitting text cannot avoid a collision it does not
   * know about, so BUZZ and the CTA claim their space FIRST and the text is
   * fitted into what is left. That is also what makes one headline safe at four
   * aspect ratios without anyone checking each export by eye. */

  /* --- zone 1: BUZZ. Drawn first so he sits behind the type. -------------- */
  const buzzImg = assets.buzz[content.buzz];
  let buzzLeft = w;
  let buzzTop = h;
  if (buzzImg) {
    // A very tall artboard gives BUZZ proportionally less height, or he dominates it.
    const bh = (wide ? h * 0.86 : h * (veryTall ? 0.3 : 0.36)) * scaleOf("buzz");
    const bw = (buzzImg.width / buzzImg.height) * bh;
    /* On a wide artboard BUZZ runs off the right edge on purpose, but the bleed
       has to be a fixed FRACTION OF HIM rather than a fixed fraction of the
       artboard - otherwise how much of his hand is lost depends on how wide the
       format happens to be, and a 16:9 thumbnail crops him noticeably harder
       than a 1.9:1 link preview. Anchoring to his own width keeps the same
       deliberate sliver off every wide format. */
    const defCx = wide ? w - bw * 0.44 : w * 0.72;
    const defCy = (wide ? h * 1.02 : h - m * 0.4) - bh / 2;
    const { cx, cy, rotation } = place("buzz", defCx, defCy);
    const bottom = cy + bh / 2;
    buzzLeft = cx - bw / 2;
    buzzTop = cy - bh / 2;
    regions.push({ id: "buzz", label: "BUZZ", cx, cy, w: bw, h: bh, rotation: (rotation * 180) / Math.PI });
    if (useInk("buzz")) {
      /* The misregistered silhouette. He himself is drawn untouched a line
         later - the art never warps. In "still" this is one fixed offset, the
         permanent print wonk a prop carries; in "live" it breathes. */
      const sil = silhouetteOf(buzzImg, PALETTE.charcoal);
      const { dx, dy } = misregOffset(S);
      if (sil) {
        // A touch larger than the art, so it reads as an ink edge that breathes
        // rather than as a drop shadow sliding around behind him.
        const g = 1.015;
        const sh = bh * g;
        const sw = (sil.width / sil.height) * sh;
        ctx.globalAlpha = 0.9;
        at(cx, cy, rotation, () =>
          ctx.drawImage(sil, cx - sw / 2 + dx, bottom - bh - (sh - bh) / 2 + dy, sw, sh),
        );
        ctx.globalAlpha = 1;
      }
    }
    setInk(0);
    at(cx, cy, rotation, () => drawImageByHeight(ctx, buzzImg, bh, cx, bottom));
  }

  /* --- zone 2: the wordmark, in a corner ---------------------------------- */
  const mark = assets.wordmark[cw.wordmark];
  const markW = w * (wide ? 0.16 : 0.26) * scaleOf("wordmark");
  const markH = (mark.height / mark.width) * markW;
  const wm = place("wordmark", m + markW / 2, m + markH / 2);
  const wmx = wm.cx - markW / 2;
  const wmy = wm.cy - markH / 2;
  /* The wordmark takes ink like anything else. The bible's "don't re-effect the
     wordmark" was read here as ruling that out, and it was raised on those
     grounds; Carl - whose bible it is - ruled that a misregistered print edge is
     the brand's own material rather than an effect applied to the mark. */
  if (useInk("wordmark")) {
    const sil = silhouetteOf(mark, PALETTE[cw.wordmark === "cream" ? "charcoal" : "offwhite"]);
    const { dx, dy } = misregOffset(S);
    if (sil) {
      ctx.globalAlpha = 0.7;
      at(wm.cx, wm.cy, wm.rotation, () => ctx.drawImage(sil, wmx + dx, wmy + dy, markW, markH));
      ctx.globalAlpha = 1;
    }
  }
  setInk(0);
  at(wm.cx, wm.cy, wm.rotation, () => ctx.drawImage(mark, wmx, wmy, markW, markH));
  regions.push({
    id: "wordmark",
    label: "Wordmark",
    cx: wm.cx,
    cy: wm.cy,
    w: markW,
    h: markH,
    rotation: (wm.rotation * 180) / Math.PI,
  });

  /* Clear space of at least the height of the "S" - which on this wordmark is
   * effectively its full height, since the S spans the cap line to the baseline. */
  const top = m + markH * (wide ? 1.5 : 1.9);

  /* --- zone 3: the CTA starburst, bottom left ----------------------------- */
  const hasCta = content.cta.trim().length > 0;
  const r = hasCta ? (wide ? h * 0.13 : Math.min(w, h) * 0.125) * scaleOf("cta") : 0;
  const ctaTop = hasCta ? h - m - r * 2 : h;

  /* --- zone 4: the type, in whatever is left ------------------------------ */
  // Wide: the column stops short of BUZZ. Tall: it is full width, so it has to
  // clear BUZZ and the starburst vertically instead.
  const colW = wide
    ? Math.max(w * 0.28, Math.min(w * 0.5, buzzLeft - m - w * 0.02))
    : w - m * 2;
  /* In the tall sizes the starburst sits on the floor at the left and the type
   * has to clear it. The landscape has no vertical room to spare, so there the
   * badge tucks into the RIGHT of the text column instead - between the copy and
   * BUZZ - and the type keeps the full height. Stacking it under the copy in a
   * 630px banner squeezed the supporting line to an unreadable sliver. */
  const textBottom = wide ? h - m : Math.min(buzzTop - m * 0.3, ctaTop - m * 0.4);
  const textH = Math.max(textBottom - top, h * 0.12);

  // The landscape gives more of its column to the headline: it is a banner, it
  // is seen small and in a feed, and its supporting line has to earn its place.
  /* Text takes a size multiplier too. It used to be the one thing that could not
     be resized, on the grounds that its size comes from fitting it to its zone -
     true, but that was the cage talking. The multiplier scales the ceiling the
     fit works against, so the text still wraps and balances; it is just allowed
     to be bigger or smaller than the zone suggested. */
  const hs = scaleOf("headline");
  const head = fitText(
    ctx,
    content.headline,
    DISPLAY,
    colW,
    textH * (wide ? 0.55 : 0.66) * hs,
    h * 0.22 * hs,
  );
  const hp = place("headline", m + colW / 2, top + head.height / 2);
  regions.push({
    id: "headline",
    label: "Headline",
    cx: hp.cx,
    cy: hp.cy,
    w: colW,
    h: head.height,
    rotation: (hp.rotation * 180) / Math.PI,
  });
  at(hp.cx, hp.cy, hp.rotation, () =>
    drawLines(ctx, head, DISPLAY, hp.cx - colW / 2, hp.cy - head.height / 2, {
      fill: PALETTE[cw.ink],
      outline: cw.outline ? PALETTE[cw.outline] : null,
      outlineWidth: 0.055,
    }),
  );

  if (content.body.trim()) {
    const bodyTop = top + head.height + m * 0.42;
    const ys = scaleOf("body");
    const bodyH = Math.max(textBottom - bodyTop, h * 0.04) * ys;
    // The landscape body stops short of the badge parked at the column's right.
    const bodyW = wide ? colW - r * 2 - m * 0.5 : colW * 0.94;
    const body = fitText(ctx, content.body, BODY, bodyW, bodyH, h * 0.034 * ys);
    const yp = place("body", m + bodyW / 2, bodyTop + body.height / 2);
    regions.push({
      id: "body",
      label: "Supporting line",
      cx: yp.cx,
      cy: yp.cy,
      w: bodyW,
      h: body.height,
      rotation: (yp.rotation * 180) / Math.PI,
    });
    at(yp.cx, yp.cy, yp.rotation, () =>
      drawLines(ctx, body, BODY, yp.cx - bodyW / 2, yp.cy - body.height / 2, {
        fill: PALETTE[cw.ink],
      }),
    );
  }

  if (hasCta) {
    const cp = place("cta", wide ? m + colW - r : m + r, h - m - r);
    const { cx, cy } = cp;
    regions.push({
      id: "cta",
      label: "Call to action",
      cx,
      cy,
      w: r * 2,
      h: r * 2,
      rotation: (cp.rotation * 180) / Math.PI,
    });
    // The badge is drawn linework, so it takes the boil. Its label does not:
    // text never boils, so drawStarburst puts it through the plain context.
    const badgeInked = useInk("cta");
    setInk(BOIL.starburst);
    at(cx, cy, cp.rotation, () =>
      drawStarburst(ctx, badgeInked ? inkCtx(ctx) : ctx, cx, cy, r, content.cta, PALETTE[cw.ctas[0]], ink),
    );
    setInk(0);
  }

  /* --- your own layers, over the design and under the paper --------------- */
  regions.push(
    ...drawLayers(ctx, size, content.layers, assets.images, {
      ink: inkMode,
      frame,
      scale: S,
      defaultInk: ink,
      hide,
    }),
  );

  /* --- the paper, over everything ---------------------------------------- */
  drawGrain(ctx, w, h, transparent);

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
