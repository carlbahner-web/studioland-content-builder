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
export type Manipulator = {
  /** Fractional centre, falling back to where the last draw put it. */
  pos: (id: string, fallback: { x: number; y: number }) => { x: number; y: number };
  setPos: (id: string, x: number, y: number) => void;
  /** One number that sizes the element proportionally. */
  scale: (id: string) => number;
  setScale: (id: string, v: number) => void;
  rot: (id: string) => number;
  setRot: (id: string, deg: number) => void;
  /* Independent extents, for the elements that have them: a shape has a width
   * and a height, a text box has a width it wraps to and a height it works out
   * for itself. null means corners only - an image's aspect is the artwork's,
   * and stretching it is not a thing this tool offers. */
  extent: (id: string) => { w: number; h: number | null } | null;
  setExtent: (id: string, w: number, h: number) => void;
  locked: (id: string) => boolean;
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
  /* Dragging from empty artboard sweeps out a selection. `add` is set when
     shift was held, so a marquee can extend a selection rather than replace it. */
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: string[] }
  | {
      kind: "handle";
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
  /** The sweep rectangle while one is being dragged, in artboard pixels. */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  /** Displayed size, for turning screen distances into artboard ones. */
  const [view, setView] = useState({ w: 0, h: 0 });

  /* --------------------------------------------------------------- the art */

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!animate) {
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, { ink });
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
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, { frame, ink, curtain });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, colorway, content, assets, animate, curtain, ink, onRegions]);

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

    // The group's extent, so you can see what a nudge or an align will act on.
    if (chosen.length > 1) {
      const u = unionBox(chosen);
      twoTone(() => g.strokeRect(u.x0, u.y0, u.x1 - u.x0, u.y1 - u.y0), "#3A6168", [7, 5]);
    }

    const r = chosen.length === 1 ? chosen[0] : null;
    if (r && !manip.locked(r.id)) {
      g.save();
      g.translate(r.cx, r.cy);
      g.rotate(rad(r.rotation ?? 0));
      const dot = (x: number, y: number) => {
        g.beginPath();
        g.arc(x, y, HANDLE_R * px, 0, Math.PI * 2);
        g.fillStyle = "#fcf7e8";
        g.fill();
        g.strokeStyle = "#2C2C2A";
        g.lineWidth = 1.5 * px;
        g.stroke();
      };
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
    const { px, py } = toArtboard(e);
    const selected = lone();
    const handle = handleUnder(px, py);
    if (handle && selected) {
      const r = regions.current.find((x) => x.id === selected)!;
      const local = toLocal(px, py, r.cx, r.cy, r.rotation ?? 0);
      gesture.current = {
        kind: "handle",
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
        if (at) manip.setPos(id, at.x + dx, at.y + dy);
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
      manip.setRot(g.id, Math.round(deg * 10) / 10);
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
      );
      return;
    }

    /* A corner resizes proportionally, measured as the pointer's distance from
       the centre against what it was at grab time. Measuring against the last
       frame instead would compound rounding for as long as the drag lasts. */
    const d0 = Math.hypot(g.lx0, g.ly0);
    const d1 = Math.hypot(local.x, local.y);
    if (d0 < 1) return;
    manip.setScale(g.id, Math.max(0.01, g.scale0 * (d1 / d0)));
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
    if (hit) onEdit(hit.id);
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
    drawSocialAd(ctx, size, colorway, content, assets, { ink });
    c.toBlob(async (blob) => {
      if (!blob) return;
      const how = await saveFile(`studioland-social-${size.key}-${colorway.key}.png`, blob);
      // Only fall back to press-and-hold where the browser download is the one
      // that ran AND is the unreliable kind. A confirmed save needs no follow-up.
      if (how === "browser" && onHeld) onHeld(c.toDataURL("image/png"));
    }, "image/png");
  }, [size, colorway, content, assets, ink, onHeld]);

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
        draw: (frame) => drawSocialAd(octx, size, colorway, content, assets, { frame, ink, curtain }),
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
      <div className="board">
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
      </div>
    </figure>
  );
}
