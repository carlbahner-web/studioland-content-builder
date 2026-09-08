/* The artboard, and everything you do to it with a pointer.
 *
 * TWO CANVASES, STACKED, and the reason is the whole design of this file. The
 * lower one is the real 1080px artboard - the thing that exports, drawn by the
 * template, with nothing on it that is not in the design. The upper one is
 * chrome: the selection box, the handles, the snap guides. Drawing the chrome
 * onto the artboard and clearing it before export is the obvious alternative and
 * it is a trap - the export path would depend on the editor having tidied up
 * after itself, and the first time it did not you would ship a PNG with a
 * selection rectangle on it. Two surfaces makes that impossible rather than
 * unlikely.
 *
 * The overlay is also where every pointer event lands, since it is on top. That
 * is convenient rather than a problem: hit-testing happens in artboard
 * coordinates either way.
 *
 * HANDLES ARE SIZED IN SCREEN PIXELS, not artboard pixels. A 1080px artboard
 * shown at 380px wide would otherwise draw a 10px handle at 3.5px, which is not
 * grabbable with a finger and barely with a mouse. So the overlay is sized to
 * its displayed box times the device pixel ratio, and artboard coordinates are
 * scaled into it - which also means the handles come out crisp rather than
 * resampled.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Colorway, Format } from "./brand.ts";
import { FPS, type InkMode } from "./boil.ts";
import { saveFile } from "./save.ts";
import { encodeMp4 } from "./video.ts";
import { snapBox, snapTargets, snapThreshold, type Box, type Guide } from "./snap.ts";
import { TEXT_PLACEHOLDER } from "./layers.ts";
import { FIRST_BASELINE } from "./render.ts";
import {
  drawSocialAd,
  hitRegion,
  LOOP_FRAMES,
  type Assets,
  type Region,
  type SocialAdContent,
} from "./templates/socialAd.ts";

/* What the artboard can be asked to change about an element, without knowing
 * whether it is one of the template's five or a layer you added.
 *
 * The two are stored differently - a template element carries a scale
 * MULTIPLIER against whatever the layout chose for this format, a layer carries
 * its size outright - and the difference genuinely matters to everything else.
 * It does not matter here. A handle drag is "this element is now this big", and
 * these accessors are where that sentence is translated. */
/* Every setter takes an optional history TAG, and it identifies the GESTURE
 * rather than the element - which is the whole point of it being a parameter.
 * Undo coalesces consecutive edits carrying the same tag, so tagging by element
 * works for a single drag and falls apart the moment a drag touches more than
 * one: two elements moving together emit "drag:A", "drag:B", "drag:A", ... and
 * because each push has a different tag from the one before it, none of them
 * fold. A two-element drag was recording dozens of undo steps. One tag for the
 * whole gesture makes any drag one step, however many things it moves. */
export type Manipulator = {
  /** Fractional centre, falling back to where the last draw put it. */
  pos: (id: string, fallback: { x: number; y: number }) => { x: number; y: number };
  setPos: (id: string, x: number, y: number, tag?: string) => void;
  /** One number that sizes the element proportionally. */
  scale: (id: string) => number;
  setScale: (id: string, v: number, tag?: string) => void;
  rot: (id: string) => number;
  setRot: (id: string, deg: number, tag?: string) => void;
  /* Independent extents, for the elements that have them: a shape has a width
   * and a height, a text box has a width it wraps to and a height it works out
   * for itself. null means corners only - an image's aspect is the artwork's,
   * and stretching it is not a thing this tool offers. */
  extent: (id: string) => { w: number; h: number | null } | null;
  setExtent: (id: string, w: number, h: number, tag?: string) => void;
  locked: (id: string) => boolean;
  /* Everything it takes to put a caret on an element, or null where typing on
   * the artboard is not offered. The template's headline and supporting line
   * are null on purpose: their size is chosen by fitting them to a zone, so a
   * caret would need the autofit re-run per keystroke to sit in the right
   * place, and the panel field is honest about what is actually happening. */
  editable: (id: string) => TextEdit | null;
  setText: (id: string, value: string) => void;
};

/** Metrics in ARTBOARD pixels; the caller scales them to the display. */
export type TextEdit = {
  text: string;
  /** A CSS font-family that resolves - the faces are registered on document.fonts. */
  family: string;
  size: number;
  lineHeight: number;
  tracking: number;
  align: "left" | "center" | "right";
  caps: boolean;
  color: string;
  /** The box the text wraps to. */
  w: number;
  rotation: number;
  /** Centre, as a fraction of the artboard. */
  x: number;
  y: number;
};

type HandleId = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w" | "rot";

const CORNERS: HandleId[] = ["nw", "ne", "se", "sw"];

/** Handle radius and the rotate handle's stand-off, in SCREEN pixels. */
const HANDLE_R = 6;
const GRAB_R = 14;
const ROT_GAP = 26;

/* A handle needs room, and a thin element does not have it.
 *
 * A rule is 540 x 21 artboard pixels. Its n and s handles sit 10 pixels from
 * its centre, and the grab radius is about 24 - so the whole body of the rule
 * is inside its own handles, and pressing anywhere on it starts a resize. The
 * most common shape in the tool could not be dragged at all.
 *
 * So a handle only exists on an axis with room for both it and a grabbable
 * interior. Below that, moving is what the press means: it is the more common
 * intent, and the size is still adjustable from the panel and from the axis
 * that does have room. */
const HANDLE_ROOM = 3.2;

/** Which handles this box is big enough to offer. `u` is one screen pixel in
 *  artboard units, so the test is in the units the handles are actually drawn at. */
function handlesFor(
  r: { w: number; h: number },
  ext: { w: number; h: number | null } | null,
  u: number,
): HandleId[] {
  const room = GRAB_R * HANDLE_ROOM * u;
  const wide = r.w >= room;
  const tall = r.h >= room;
  const out: HandleId[] = [];
  if (wide && tall) out.push(...CORNERS);
  if (ext && wide) out.push("e", "w");
  if (ext && ext.h !== null && tall) out.push("n", "s");
  return out;
}

/** Where a handle sits, in the element's own unrotated frame. */
function handleOffset(h: HandleId, w: number, h2: number): { x: number; y: number } {
  switch (h) {
    case "nw": return { x: -w / 2, y: -h2 / 2 };
    case "ne": return { x: w / 2, y: -h2 / 2 };
    case "se": return { x: w / 2, y: h2 / 2 };
    case "sw": return { x: -w / 2, y: h2 / 2 };
    case "n": return { x: 0, y: -h2 / 2 };
    case "e": return { x: w / 2, y: 0 };
    case "s": return { x: 0, y: h2 / 2 };
    default: return { x: -w / 2, y: 0 };
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/* How far the caret's first line has to be pushed down to sit where the canvas
 * would have drawn it.
 *
 * The canvas puts a baseline at FIRST_BASELINE of the way down its line box.
 * CSS instead splits the leading evenly above and below the glyphs, so with a
 * tight display face the two land within a pixel of each other and with the
 * body face's 1.82 leading they are a quarter of an em apart - which reads as
 * the text jumping the moment the caret closes. Measuring the font rather than
 * assuming its proportions is what makes this exact for all three faces. */
const scratch =
  typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");

function baselineShift(family: string, fontPx: number, linePx: number): number {
  if (!scratch) return 0;
  scratch.font = `${fontPx}px "${family}", sans-serif`;
  const m = scratch.measureText("Hxg");
  const ascent = m.fontBoundingBoxAscent ?? fontPx * 0.8;
  const descent = m.fontBoundingBoxDescent ?? fontPx * 0.2;
  const css = (linePx - (ascent + descent)) / 2 + ascent;
  return Math.max(0, FIRST_BASELINE * linePx - css);
}

/** A point in the element's own frame, given its centre and rotation. */
function toLocal(px: number, py: number, cx: number, cy: number, deg: number) {
  const a = -rad(deg);
  const dx = px - cx;
  const dy = py - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** A rectangle with its corners in either order, put right way round. */
function normalise(r: { x0: number; y0: number; x1: number; y1: number }) {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/** The axis-aligned box around some regions. Empty gives a zero box at the origin. */
function unionBox(rs: { cx: number; cy: number; w: number; h: number; rotation?: number }[]) {
  if (!rs.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rs) {
    /* A rotated element's own box is not axis-aligned, so its four corners are
       projected out and the extremes taken. Using w and h directly would draw a
       group box that visibly clips a turned element. */
    const a = rad(r.rotation ?? 0);
    const hw = r.w / 2;
    const hh = r.h / 2;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const px = r.cx + sx * hw * Math.cos(a) - sy * hh * Math.sin(a);
      const py = r.cy + sx * hw * Math.sin(a) + sy * hh * Math.cos(a);
      x0 = Math.min(x0, px);
      y0 = Math.min(y0, py);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
  }
  return { x0, y0, x1, y1 };
}

/* A marquee catches what it TOUCHES, not only what it fully contains. Requiring
   containment means sweeping a headline that runs past the artboard edge can
   never catch it, which is the case you most want the sweep for. */
function intersects(
  box: { x0: number; y0: number; x1: number; y1: number },
  r: { cx: number; cy: number; w: number; h: number; rotation?: number },
): boolean {
  const u = unionBox([r]);
  return !(u.x1 < box.x0 || u.x0 > box.x1 || u.y1 < box.y0 || u.y0 > box.y1);
}

type Gesture =
  /* A move carries EVERY selected element's position at grab time and applies
     one shared delta, rather than each element tracking the pointer on its own.
     Two things fall out of that: the group keeps its internal spacing exactly,
     and one snap decision applies to the whole selection instead of each
     element snapping somewhere different. */
  | {
      kind: "move";
      tag: string;
      ids: string[];
      from: Record<string, { x: number; y: number }>;
      /** Pointer at grab time, in artboard fractions. */
      px0: number;
      py0: number;
      /** The selection's bounds at grab time, in artboard pixels, and whether
       *  they are meaningful - see the snap in onMove. */
      u0: { x0: number; y0: number; x1: number; y1: number };
      spun: boolean;
    }
  /* Scaling or turning a whole selection at once, about its own centre.
     Every element's position AND size are taken at grab time and derived from
     the one factor, so the group scales as a rigid arrangement: the spacing
     between things grows with the things, which is what makes it a resize of
     the composition rather than of each piece separately. */
  | {
      kind: "group";
      tag: string;
      mode: "scale" | "rot";
      ids: string[];
      /** The group's centre at grab time, in artboard pixels. */
      cx: number;
      cy: number;
      from: Record<string, { x: number; y: number; scale: number; rot: number }>;
      /** Pointer distance and angle from that centre at grab time. */
      d0: number;
      a0: number;
    }
  /* Dragging from empty artboard sweeps out a selection. `add` is set when
     shift was held, so a marquee can extend a selection rather than replace it. */
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: string[] }
  | {
      kind: "handle";
      tag: string;
      id: string;
      handle: HandleId;
      /** The element as it was at grab time - every gesture is measured from
       *  here rather than from the last frame, so nothing accumulates drift. */
      box: Region;
      scale0: number;
      rot0: number;
      extent0: { w: number; h: number | null } | null;
      /** Pointer in the element's frame at grab time. */
      lx0: number;
      ly0: number;
    };

export function Artboard({
  size,
  colorway,
  content,
  assets,
  animate,
  curtain,
  ink,
  transparent,
  selection,
  onSelect,
  onEdit,
  onRegions,
  manip,
  onHeld,
}: {
  size: Format;
  colorway: Colorway;
  content: SocialAdContent;
  assets: Assets;
  animate: boolean;
  curtain: boolean;
  ink: InkMode;
  /** Leave the ground unpainted. The PNG export honours it; the MP4 cannot. */
  transparent: boolean;
  /** Everything selected, in no particular order. */
  selection: string[];
  onSelect: (ids: string[]) => void;
  /** Double-click, which means "let me type into this one". */
  onEdit: (id: string) => void;
  /* Where everything landed, so the panel can align to an edge and show a real
     size. Reported from the DRAW, never recomputed - and only when the preview
     is still, because a running animation would push a new array 30 times a
     second for a readout nobody can read at that speed. */
  onRegions: (regions: Region[]) => void;
  manip: Manipulator;
  /** Where a press-and-hold fallback should put the finished image. */
  onHeld: ((dataUrl: string) => void) | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  /* Regions come from the LAST DRAW rather than being recomputed here. The
     template already knows where everything ended up; hit-testing against a
     second copy of that maths is how the two drift apart. */
  const regions = useRef<Region[]>([]);
  const gesture = useRef<Gesture | null>(null);
  /** One tag per gesture, so a drag is one undo step whatever it moves. */
  const gestureTag = useRef(0);
  const newTag = (kind: string) => `${kind}:${++gestureTag.current}`;
  /** The sweep rectangle while one is being dragged, in artboard pixels. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  /** Displayed size, for turning screen distances into artboard ones. */
  const [view, setView] = useState({ w: 0, h: 0 });
  /* The layer being typed into, if any. A real <textarea> laid over the
     artboard in the layer's own face, size, colour and alignment - not a
     canvas-drawn caret. Text selection, the system keyboard, autocorrect, IME
     composition and every accessibility affordance come free that way, and
     every one of them would have had to be reimplemented badly otherwise. */
  const [editing, setEditing] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const edit = editing ? manip.editable(editing) : null;

  /* --------------------------------------------------------------- the art */

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!animate) {
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, {
        ink,
        hide: editing,
        transparent,
      });
      onRegions(regions.current);
      return;
    }
    /* The preview is driven by the same frame INDEX the exporter uses, not by
       elapsed time, so what plays here is frame-for-frame what lands in the
       MP4 - just possibly at a different speed if the tab is busy. */
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const frame = Math.floor(((now - start) / 1000) * FPS) % LOOP_FRAMES;
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, {
        frame,
        ink,
        curtain,
        transparent,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, colorway, content, assets, animate, curtain, ink, onRegions, editing, transparent]);

  /* ------------------------------------------------------------ the chrome */
  /* The overlay effect is declared AFTER the draw effect on purpose: effects
     run in the order they were declared, so by the time this one reads
     regions.current the draw that produced them has already happened. Both
     depend on `content`, so any edit redraws the art and then re-places the
     handles on top of it, in that order, in one pass. */

  useLayoutEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setView((v) => (v.w === r.width && v.h === r.height ? v : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = overlay.current;
    if (!el || !view.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(view.w * dpr);
    el.height = Math.round(view.h * dpr);
    const g = el.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, el.width, el.height);
    // One transform takes artboard pixels to overlay pixels; every length below
    // is therefore in SCREEN units divided back out of it.
    const k = (view.w / size.w) * dpr;
    g.setTransform(k, 0, 0, k, 0, 0);
    const px = 1 / k;

    for (const guide of guides) {
      g.strokeStyle = "#FE3636";
      g.lineWidth = 1 * px;
      g.setLineDash([6 * px, 5 * px]);
      g.beginPath();
      if (guide.axis === "x") {
        g.moveTo(guide.at, 0);
        g.lineTo(guide.at, size.h);
      } else {
        g.moveTo(0, guide.at);
        g.lineTo(size.w, guide.at);
      }
      g.stroke();
      g.setLineDash([]);
    }

    /* Every selected element gets an outline; only a LONE selection gets
       handles. Resizing or rotating several things at once has to decide what
       it means - about the group's centre, about each element's own? - and
       getting that wrong silently scatters a layout. Moving and aligning are
       what multi-select is actually for, so those are what it does. */
    const chosen = regions.current.filter((x) => selection.includes(x.id));

    /* TWO STROKES, cream under charcoal. A single-colour selection box is
       invisible on the ground that happens to match it, and every colour in the
       palette IS a ground here - a teal box on the teal colourway simply is not
       there. A light halo under a dark line reads on all five. */
    const twoTone = (draw: () => void, dark: string, dash: number[] = []) => {
      g.setLineDash(dash.map((d) => d * px));
      g.strokeStyle = "rgba(252,247,232,0.9)";
      g.lineWidth = 3.5 * px;
      draw();
      g.strokeStyle = dark;
      g.lineWidth = 1.25 * px;
      draw();
      g.setLineDash([]);
    };

    for (const r of chosen) {
      const locked = manip.locked(r.id);
      g.save();
      g.translate(r.cx, r.cy);
      g.rotate(rad(r.rotation ?? 0));
      twoTone(
        () => g.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h),
        locked ? "#8a8a86" : "#2C2C2A",
        locked ? [5, 4] : [],
      );
      g.restore();
    }

    const dot = (x: number, y: number) => {
      g.beginPath();
      g.arc(x, y, HANDLE_R * px, 0, Math.PI * 2);
      g.fillStyle = "#fcf7e8";
      g.fill();
      g.strokeStyle = "#2C2C2A";
      g.lineWidth = 1.5 * px;
      g.stroke();
    };

    /* The group's own box, with corner handles. CORNERS ONLY, and that is the
       whole ruling: a uniform scale about the centre is unambiguous - the
       arrangement grows, everything keeps its proportions - while a side handle
       would have to mean stretching text and photographs out of shape, which is
       never what "make these bigger" meant. */
    if (chosen.length > 1) {
      const u = unionBox(chosen);
      twoTone(() => g.strokeRect(u.x0, u.y0, u.x1 - u.x0, u.y1 - u.y0), "#3A6168", [7, 5]);
      const box = { w: u.x1 - u.x0, h: u.y1 - u.y0 };
      const cx = (u.x0 + u.x1) / 2;
      const cy = (u.y0 + u.y1) / 2;
      if (chosen.some((r) => !manip.locked(r.id))) {
        for (const h of handlesFor(box, null, px)) {
          const o = handleOffset(h, box.w, box.h);
          dot(cx + o.x, cy + o.y);
        }
        const gap = ROT_GAP * px;
        twoTone(() => {
          g.beginPath();
          g.moveTo(cx, u.y0);
          g.lineTo(cx, u.y0 - gap);
          g.stroke();
        }, "#2C2C2A");
        dot(cx, u.y0 - gap);
      }
    }

    const r = chosen.length === 1 ? chosen[0] : null;
    if (r && !manip.locked(r.id)) {
      g.save();
      g.translate(r.cx, r.cy);
      g.rotate(rad(r.rotation ?? 0));
      // Exactly the handles the hit test will accept - drawing one that cannot
      // be grabbed is worse than not drawing it.
      for (const h of handlesFor(r, manip.extent(r.id), px)) {
        const o = handleOffset(h, r.w, r.h);
        dot(o.x, o.y);
      }
      // The rotate handle, on a stalk above the top edge.
      const gap = ROT_GAP * px;
      twoTone(() => {
        g.beginPath();
        g.moveTo(0, -r.h / 2);
        g.lineTo(0, -r.h / 2 - gap);
        g.stroke();
      }, "#2C2C2A");
      dot(0, -r.h / 2 - gap);
      g.restore();
    }

    // The marquee itself, drawn last so it sits over everything it is catching.
    if (marquee) {
      g.fillStyle = "rgba(58,97,104,0.12)";
      g.fillRect(marquee.x0, marquee.y0, marquee.x1 - marquee.x0, marquee.y1 - marquee.y0);
      twoTone(
        () => g.strokeRect(marquee.x0, marquee.y0, marquee.x1 - marquee.x0, marquee.y1 - marquee.y0),
        "#3A6168",
        [5, 4],
      );
    }
  }, [selection, guides, view, size, content, manip, marquee]);

  /* The box is sized to its own content and then centred on that height, so
     the caret grows symmetrically the way the drawn text does. Anchoring the
     top instead would drift half a line out of place for every line added.
     Measuring means letting the height go auto and reading scrollHeight, which
     is a DOM write React knows nothing about - so `height` and `top` are set
     here rather than through the style prop, and React is not given a second
     opinion on them. Sharing the property does not work: React only writes when
     the value it last rendered changed, so once the measured height settles it
     stops writing and the `auto` left behind from measuring is what sticks. */
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el || !edit || !view.w) return;
    const k = view.w / size.w;

    // Push the first line down to where the canvas would have put its baseline.
    const pad = baselineShift(edit.family, edit.size * k, edit.lineHeight * k);
    el.style.paddingTop = `${pad}px`;
    el.style.height = "auto";
    const h = el.scrollHeight;
    el.style.height = `${h}px`;
    /* The TEXT is what has to be centred on the layer, not the box - so the
       padding is discounted from the centring exactly as it was added to the
       height. */
    el.style.top = `${edit.y * view.h - h / 2 - pad / 2}px`;

    /* Horizontally the two disagree about what is centred on the layer, and the
       canvas is the one that has to win because it is what exports. It centres
       the INK - the width the letters actually run to - which is what makes a
       selection box hug a short centred line instead of a stretch of empty
       artboard. A textarea can only centre its BOX. So the box is placed to put
       its text where the canvas puts it, while keeping the full measure width
       so the wrap still breaks in the same places. */
    const measure = edit.w * k;
    const ink = (regions.current.find((r) => r.id === editing)?.w ?? edit.w) * k;
    const cx = edit.x * view.w;
    el.style.width = `${measure}px`;
    el.style.left = `${
      edit.align === "left"
        ? cx - ink / 2
        : edit.align === "right"
          ? cx + ink / 2 - measure
          : cx - measure / 2
    }px`;
  }, [edit?.text, edit?.size, edit?.w, edit?.x, edit?.y, edit?.align, view.w, view.h, editing, edit, size.w]);

  useEffect(() => {
    const el = ta.current;
    if (!el || !edit) return;
    el.focus();
    /* A layer that still says what it was born saying is a placeholder, so
       select it - the first thing you type should replace it. Anything you have
       already written gets a caret at the end instead. */
    if (edit.text === TEXT_PLACEHOLDER) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Nothing to type into any more - a format switch, an undo that removed it.
  useEffect(() => {
    if (editing && !manip.editable(editing)) setEditing(null);
  }, [editing, manip]);

  /* ------------------------------------------------------------- pointers */

  const toArtboard = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      px: ((e.clientX - r.left) / r.width) * size.w,
      py: ((e.clientY - r.top) / r.height) * size.h,
    };
  };

  /** One screen pixel, in artboard units. */
  const unit = () => (view.w ? size.w / view.w : 1);

  /* Handles belong to a LONE selection - see the overlay for why. */
  const lone = (): string | null => (selection.length === 1 ? selection[0] : null);

  /** The group's box when several things are selected and any of them can move. */
  const groupBox = () => {
    if (selection.length < 2) return null;
    const chosen = regions.current.filter((r) => selection.includes(r.id));
    if (chosen.length < 2 || !chosen.some((r) => !manip.locked(r.id))) return null;
    const u = unionBox(chosen);
    return {
      cx: (u.x0 + u.x1) / 2,
      cy: (u.y0 + u.y1) / 2,
      w: u.x1 - u.x0,
      h: u.y1 - u.y0,
      top: u.y0,
    };
  };

  /** A group handle under the point: its corners, or the rotate stalk. */
  const groupHandleUnder = (px: number, py: number): HandleId | null => {
    const b = groupBox();
    if (!b) return null;
    const reach = GRAB_R * unit();
    if (Math.hypot(px - b.cx, py - (b.top - ROT_GAP * unit())) <= reach) return "rot";
    // The union box is axis-aligned by construction, so no local frame is needed.
    for (const h of handlesFor(b, null, unit())) {
      const o = handleOffset(h, b.w, b.h);
      if (Math.hypot(px - (b.cx + o.x), py - (b.cy + o.y)) <= reach) return h;
    }
    return null;
  };

  const handleUnder = (px: number, py: number): HandleId | null => {
    const selected = lone();
    if (!selected) return null;
    const r = regions.current.find((x) => x.id === selected);
    if (!r || manip.locked(r.id)) return null;
    const ext = manip.extent(r.id);
    const reach = GRAB_R * unit();
    const local = toLocal(px, py, r.cx, r.cy, r.rotation ?? 0);
    const candidates: HandleId[] = [...handlesFor(r, ext, unit()), "rot"];
    for (const h of candidates) {
      const o =
        h === "rot"
          ? { x: 0, y: -r.h / 2 - ROT_GAP * unit() }
          : handleOffset(h, r.w, r.h);
      if (Math.hypot(local.x - o.x, local.y - o.y) <= reach) return h;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Pressing anywhere on the artboard ends the edit. The change is already
    // committed on every keystroke, so there is nothing to save here.
    if (editing) setEditing(null);
    const { px, py } = toArtboard(e);
    const selected = lone();

    const group = groupHandleUnder(px, py);
    if (group) {
      const b = groupBox()!;
      const from: Record<string, { x: number; y: number; scale: number; rot: number }> = {};
      for (const id of selection) {
        if (manip.locked(id)) continue;
        const r = regions.current.find((x) => x.id === id);
        if (!r) continue;
        const at = manip.pos(id, { x: r.cx / size.w, y: r.cy / size.h });
        from[id] = { x: at.x, y: at.y, scale: manip.scale(id), rot: manip.rot(id) };
      }
      gesture.current = {
        kind: "group",
        tag: newTag("group"),
        mode: group === "rot" ? "rot" : "scale",
        ids: Object.keys(from),
        cx: b.cx,
        cy: b.cy,
        from,
        d0: Math.hypot(px - b.cx, py - b.cy),
        a0: Math.atan2(py - b.cy, px - b.cx),
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const handle = handleUnder(px, py);
    if (handle && selected) {
      const r = regions.current.find((x) => x.id === selected)!;
      const local = toLocal(px, py, r.cx, r.cy, r.rotation ?? 0);
      gesture.current = {
        kind: "handle",
        tag: newTag("handle"),
        id: selected,
        handle,
        box: { ...r },
        scale0: manip.scale(selected),
        rot0: manip.rot(selected),
        extent0: manip.extent(selected),
        lx0: local.x,
        ly0: local.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const extend = e.shiftKey;
    const hit = hitRegion(
      regions.current.filter((r) => !manip.locked(r.id)),
      px,
      py,
    );

    if (!hit) {
      /* Empty artboard. Shift keeps what is selected and adds to it; a plain
         press starts a fresh sweep. The selection is not cleared until the
         pointer comes up, so a press that turns out to be a click still clears
         and a press that turns out to be a drag never flickers. */
      gesture.current = {
        kind: "marquee",
        x0: px,
        y0: py,
        x1: px,
        y1: py,
        add: extend ? selection : [],
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    /* Shift toggles membership. Clicking something already selected keeps the
       whole selection and moves it - otherwise picking up a group would be
       impossible, because the press that starts the drag would collapse it to
       one element first. */
    let next: string[];
    if (extend) {
      next = selection.includes(hit.id)
        ? selection.filter((id) => id !== hit.id)
        : [...selection, hit.id];
    } else {
      next = selection.includes(hit.id) ? selection : [hit.id];
    }
    onSelect(next);
    if (!next.includes(hit.id)) return; // shift-clicked it away; nothing to drag

    const from: Record<string, { x: number; y: number }> = {};
    for (const id of next) {
      const r = regions.current.find((x) => x.id === id);
      if (!r) continue;
      from[id] = manip.pos(id, { x: r.cx / size.w, y: r.cy / size.h });
    }
    /* Positions at grab time plus the pointer at grab time: the move is a
       delta applied to all of them, so nothing jumps its centre under your
       finger and the group keeps its spacing exactly. */
    const mine = regions.current.filter((r) => next.includes(r.id));
    gesture.current = {
      kind: "move",
      tag: newTag("move"),
      ids: next,
      from,
      px0: px / size.w,
      py0: py / size.h,
      u0: unionBox(mine),
      /* A lone rotated element has no axis-aligned edges worth aligning to, so
         it offers only its centre. A group of several always offers its union,
         which is axis-aligned whatever its members are doing. */
      spun: mine.length === 1 && Math.abs((mine[0].rotation ?? 0) % 360) > 0.5,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /* What the pointer is over, so the cursor can say what a press would do. A
     rotated element's corners no longer point where their names suggest, so the
     resize cursor is picked from the handle's ACTUAL direction on screen -
     otherwise a box turned 90 degrees offers a cursor at right angles to the
     edge it would move. */
  const cursorFor = (px: number, py: number): string => {
    const grp = groupHandleUnder(px, py);
    if (grp === "rot") return "grab";
    if (grp) return grp === "nw" || grp === "se" ? "nwse-resize" : "nesw-resize";
    const h = handleUnder(px, py);
    if (h === "rot") return "grab";
    if (h) {
      const r = regions.current.find((x) => x.id === lone())!;
      const o = handleOffset(h, r.w, r.h);
      const a = Math.atan2(o.y, o.x) + rad(r.rotation ?? 0);
      const oct = ((Math.round((a * 4) / Math.PI) % 4) + 4) % 4;
      return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][oct];
    }
    const hit = hitRegion(regions.current.filter((r) => !manip.locked(r.id)), px, py);
    return hit ? "move" : "default";
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const { px, py } = toArtboard(e);
    if (!g) {
      const want = cursorFor(px, py);
      if (e.currentTarget.style.cursor !== want) e.currentTarget.style.cursor = want;
      return;
    }

    if (g.kind === "group") {
      /* Everything is derived from the values recorded at grab time, so a long
         drag cannot compound rounding, and letting go and grabbing again picks
         up exactly where it left off. */
      if (g.mode === "scale") {
        if (g.d0 < 1) return;
        const factor = Math.max(0.05, Math.hypot(px - g.cx, py - g.cy) / g.d0);
        for (const id of g.ids) {
          const f = g.from[id];
          // The POSITION scales about the centre as well as the size - that is
          // what keeps the arrangement rigid instead of piling everything up.
          manip.setPos(
            id,
            (g.cx + (f.x * size.w - g.cx) * factor) / size.w,
            (g.cy + (f.y * size.h - g.cy) * factor) / size.h,
            g.tag,
          );
          manip.setScale(id, Math.max(0.01, f.scale * factor), g.tag);
        }
        return;
      }
      let delta = Math.atan2(py - g.cy, px - g.cx) - g.a0;
      if (e.shiftKey) delta = (Math.round(((delta * 180) / Math.PI) / 15) * 15 * Math.PI) / 180;
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);
      for (const id of g.ids) {
        const f = g.from[id];
        // Each element turns on its own axis AND orbits the group's centre.
        const dx = f.x * size.w - g.cx;
        const dy = f.y * size.h - g.cy;
        manip.setPos(
          id,
          (g.cx + dx * cos - dy * sin) / size.w,
          (g.cy + dx * sin + dy * cos) / size.h,
          g.tag,
        );
        manip.setRot(id, Math.round((f.rot + (delta * 180) / Math.PI) * 10) / 10, g.tag);
      }
      return;
    }

    if (g.kind === "marquee") {
      const box = { x0: g.x0, y0: g.y0, x1: px, y1: py };
      gesture.current = { ...g, x1: px, y1: py };
      setMarquee(normalise(box));
      return;
    }

    if (g.kind === "move") {
      /* ONE delta for the whole selection, and one snap decision for it. The
         snap is computed against the group's bounding box, so a group lands as
         a unit instead of each element being pulled to a different guide. */
      let dx = px / size.w - g.px0;
      let dy = py / size.h - g.py0;

      if (!e.altKey && !e.metaKey) {
        const others = regions.current
          .filter((r) => !g.ids.includes(r.id))
          .map<Box>((r) => ({ cx: r.cx, cy: r.cy, w: r.w, h: r.h }));
        /* The bounds are the ones recorded at GRAB TIME, not the current ones.
           The elements have already moved by dx this drag, so adding dx to
           where they are now would count the drag twice and ask the snapper
           about a position twice as far out as the pointer - which snaps at the
           wrong moment and corrects towards the wrong line. */
        const u = g.u0;
        const box: Box = {
          cx: (u.x0 + u.x1) / 2 + dx * size.w,
          cy: (u.y0 + u.y1) / 2 + dy * size.h,
          w: g.spun ? 0 : u.x1 - u.x0,
          h: g.spun ? 0 : u.y1 - u.y0,
        };
        const m = Math.min(size.w, size.h) * 0.075;
        const out = snapBox(box, snapTargets(size.w, size.h, m, others), snapThreshold(size.w, size.h));
        dx += (out.cx - box.cx) / size.w;
        dy += (out.cy - box.cy) / size.h;
        setGuides(out.guides);
      } else if (guides.length) setGuides([]);

      for (const id of g.ids) {
        const at = g.from[id];
        if (at) manip.setPos(id, at.x + dx, at.y + dy, g.tag);
      }
      return;
    }

    const { box, handle } = g;
    const local = toLocal(px, py, box.cx, box.cy, box.rotation ?? 0);

    if (handle === "rot") {
      const a0 = Math.atan2(g.ly0, g.lx0);
      const a1 = Math.atan2(local.y, local.x);
      let deg = g.rot0 + ((a1 - a0) * 180) / Math.PI;
      // Shift gives the fifteens, which is where anything deliberate lands.
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      manip.setRot(g.id, Math.round(deg * 10) / 10, g.tag);
      return;
    }

    if (handle === "n" || handle === "s" || handle === "e" || handle === "w") {
      const ext = g.extent0;
      if (!ext) return;
      const horizontal = handle === "e" || handle === "w";
      const from = horizontal ? g.lx0 : g.ly0;
      const to = horizontal ? local.x : local.y;
      if (Math.abs(from) < 1) return;
      const factor = Math.max(0.02, Math.abs(to) / Math.abs(from));
      manip.setExtent(
        g.id,
        horizontal ? ext.w * factor : ext.w,
        horizontal ? (ext.h ?? 0) : (ext.h ?? 0) * factor,
        g.tag,
      );
      return;
    }

    /* A corner resizes proportionally, measured as the pointer's distance from
       the centre against what it was at grab time. Measuring against the last
       frame instead would compound rounding for as long as the drag lasts. */
    const d0 = Math.hypot(g.lx0, g.ly0);
    const d1 = Math.hypot(local.x, local.y);
    if (d0 < 1) return;
    manip.setScale(g.id, Math.max(0.01, g.scale0 * (d1 / d0)), g.tag);
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "marquee") {
      const box = normalise({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
      /* A sweep smaller than a few pixels is a CLICK on empty artboard, not a
         selection rectangle - and a click on nothing means deselect. Without
         this, an ordinary click would run the sweep, catch nothing, and clear
         the selection anyway, but a one-pixel wobble on the way out of a
         drag would also silently wipe it. */
      const swept = Math.max(box.x1 - box.x0, box.y1 - box.y0) > snapThreshold(size.w, size.h);
      if (!swept) onSelect(g.add);
      else {
        const caught = regions.current
          .filter((r) => !manip.locked(r.id) && intersects(box, r))
          .map((r) => r.id);
        onSelect([...new Set([...g.add, ...caught])]);
      }
    }
    gesture.current = null;
    setMarquee(null);
    setGuides([]);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { px, py } = toArtboard(e);
    const hit = hitRegion(regions.current.filter((r) => !manip.locked(r.id)), px, py);
    if (!hit) return;
    onSelect([hit.id]);
    // A caret on the artboard where the element can carry one; otherwise the
    // panel field, which is what onEdit does.
    if (manip.editable(hit.id)) setEditing(hit.id);
    else onEdit(hit.id);
  };

  /* -------------------------------------------------------------- exports */

  const download = useCallback(() => {
    /* Always render the STILL to a FRESH canvas, never the visible one.
       Capturing the live canvas hands you a PNG of the curtain half way across
       - and, now, of whatever the overlay happens to be showing. */
    const c = document.createElement("canvas");
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawSocialAd(ctx, size, colorway, content, assets, { ink, transparent });
    c.toBlob(async (blob) => {
      if (!blob) return;
      const how = await saveFile(`studioland-social-${size.key}-${colorway.key}.png`, blob);
      // Only fall back to press-and-hold where the browser download is the one
      // that ran AND is the unreliable kind. A confirmed save needs no follow-up.
      if (how === "browser" && onHeld) onHeld(c.toDataURL("image/png"));
    }, "image/png");
  }, [size, colorway, content, assets, ink, onHeld, transparent]);

  const exportMp4 = useCallback(async () => {
    // Encode off-screen so the visible preview keeps animating and the two
    // never contend for the same context.
    const off = document.createElement("canvas");
    off.width = size.w;
    off.height = size.h;
    const octx = off.getContext("2d");
    if (!octx) return;
    setBusy("0%");
    try {
      const { blob, codec } = await encodeMp4({
        width: size.w,
        height: size.h,
        frames: LOOP_FRAMES,
        canvas: off,
        /* NEVER transparent, whatever the design says. No browser codec will
           encode an alpha channel - VideoEncoder rejects `alpha: "keep"` on
           VP8, VP9 and AV1 alike - so a transparent video would come out as
           black rather than as a hole. Painting the ground back in is the
           honest answer, and the panel says so where the option is. */
        draw: (frame) =>
          drawSocialAd(octx, size, colorway, content, assets, { frame, ink, curtain }),
        onProgress: (done, total) => setBusy(`${Math.round((done / total) * 100)}%`),
      });
      await saveFile(`studioland-social-${size.key}-${colorway.key}.mp4`, blob);
      setBusy(codec.startsWith("H.264") ? null : `${codec} (no H.264 here)`);
      if (!codec.startsWith("H.264")) window.setTimeout(() => setBusy(null), 6000);
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e));
      window.setTimeout(() => setBusy(null), 6000);
    }
  }, [size, colorway, content, assets, curtain, ink]);

  // A fact about the shape, not about one format's name.
  const reel = size.h / size.w > 1.7;

  return (
    <figure className="card">
      <figcaption>
        <div>
          <strong>
            {size.label}
            {reel && <em className="tag">Reel</em>}
          </strong>
          <span>
            {size.w} &times; {size.h} &middot; {size.where}
          </span>
        </div>
        <div className="acts">
          <button type="button" className="go" onClick={download}>
            Save PNG
          </button>
          <button type="button" onClick={exportMp4} disabled={busy !== null}>
            {busy ?? "MP4"}
          </button>
        </div>
      </figcaption>
      {/* The lower canvas IS the 1080px artboard; only its CSS box shrinks, so
          what you see is exactly what exports. The upper one is chrome and
          never touches the export path. */}
      <div className={transparent ? "board alpha" : "board"}>
        {/* With no ground, the artboard is genuinely see-through - so the
            checkerboard goes BEHIND it, or a transparent asset would read as a
            cream one against the panel and you would not know until you dropped
            it on something dark. */}
        <canvas ref={ref} width={size.w} height={size.h} style={{ aspectRatio: `${size.w} / ${size.h}` }} />
        <canvas
          ref={overlay}
          className="chrome"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={onDouble}
        />
        {edit && view.w > 0 && (
          /* Laid out in ARTBOARD units scaled to the display, from the same
             numbers the canvas draws with, so what you type sits exactly where
             it will be drawn. `text-transform` does the caps: it is a display
             rule, so the stored text keeps whatever case you typed and turning
             All caps off later gives it back. */
          <textarea
            ref={ta}
            className="caret"
            value={edit.text}
            spellCheck={false}
            onChange={(e) => manip.setText(editing!, e.target.value)}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setEditing(null);
            }}
            style={{
              /* Geometry is deliberately absent - left, width, top, height and
                 the padding all belong to the layout effect above, which has to
                 write them directly in order to measure. React owns the
                 typography; the effect owns the box. */
              transform: `rotate(${edit.rotation}deg)`,
              fontFamily: `"${edit.family}", sans-serif`,
              fontSize: edit.size * (view.w / size.w),
              lineHeight: `${edit.lineHeight * (view.w / size.w)}px`,
              letterSpacing: `${edit.tracking * (view.w / size.w)}px`,
              textAlign: edit.align,
              textTransform: edit.caps ? "uppercase" : "none",
              color: edit.color,
            }}
          />
        )}
      </div>
    </figure>
  );
}
