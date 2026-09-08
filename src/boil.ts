/* THE BOIL — Recipe B, the canvas / linework boil.
 *
 * Ported from SL_REF_Visual_Brand_Bible_v5 part 2.6 and the runnable copy at
 * wild-ride `design-system/components/boil-canvas.html`. The bible is explicit
 * that this is copied, not rewritten: "Don't reinvent either boil - copy Recipe
 * A or Recipe B out of Part 2.6 verbatim. A from-scratch attempt working only
 * from the written rules produced an over-complicated, wrong-looking result;
 * the code and the numbers are what transfer." The hash constants, the 46-unit
 * wavelength, the +7.31 phase seed shift and the subdivision thresholds below
 * are therefore left exactly as they are in the source.
 *
 * The one deliberate change is the CLOCK. The original reads `performance.now()`
 * because it runs in a live game. An exporter cannot do that: the preview and
 * the MP4 have to be the same animation, and a wall-clock boil would make every
 * export different. So the phase is driven by FRAME INDEX instead, which also
 * lets the loop close cleanly - see FRAMES_PER_PHASE below.
 */

/* 30fps, 4 frames per phase = 7.5 phases/sec, inside the bible's "~8fps", and a
 * whole number of frames per phase so the clock lands on frame boundaries. One
 * full three-phase cycle is 12 frames, so any duration that is a multiple of 12
 * frames loops seamlessly. 130ms - the DOM recipe's figure - is 3.9 frames at
 * 30fps and would drift against the frame grid forever. */
export const FPS = 30;
export const FRAMES_PER_PHASE = 4;
export const BOIL_CYCLE_FRAMES = FRAMES_PER_PHASE * 3;

export function boilPhase(frame: number): number {
  return Math.floor(frame / FRAMES_PER_PHASE) % 3;
}

/* Amplitudes in DESIGN units, multiplied by the stage scale at draw time - never
 * device pixels, or the boil changes character between sizes. One registry;
 * never inline a number at a call site. */
export const BOIL = {
  starburst: 1.7,
  curtain: 0.22,
  /** Print misregistration for live bitmap art, in design units. */
  misreg: 2.6,
} as const;

/* THREE STATES, matching what the CRM's own line does (src/components/Wobble.tsx):
 *
 *   off   - straight machine edges. No wonk at all. Only really useful for
 *           checking what the boil is contributing.
 *   still - the wonk drawn once and held. This is the default and it is what a
 *           PNG should carry: the bible gives the game's props "~1px of
 *           permanent wonk", and Wobble.tsx puts it plainly - a hand-drawn line
 *           is "just what lines look like here - the brand, not decoration".
 *   live  - the three phases cycling on the ~8fps clock. The flicker, which
 *           Wobble.tsx reserves for "the one thing that matters on a page".
 *
 * A still is NOT the boil turned off; it is one frame of the boil held. That
 * distinction is the whole reason a still asset still looks hand-inked.
 */
export type InkMode = "off" | "still" | "live";

/* Phase 1, the middle drawing - copied from Wobble.tsx's STILL_FRAME, and for
 * its reason: going live from the middle phase does not jump on the first
 * frame, where going live from phase 0 or 2 would. */
const STILL_PHASE = 1;

let mode: InkMode = "still";
let phase = STILL_PHASE;
let inkAmp = 0;
let inkKey = 0;
let S = 1;

export function setInkMode(m: InkMode): void {
  mode = m;
}

/** Stage scale: our design unit is 1/1080 of the artboard's short edge. */
export function stageScale(w: number, h: number): number {
  return Math.min(w, h) / 1080;
}

/** `frame` null means a still - hold the middle phase whatever the mode. */
export function setBoilFrame(frame: number | null, scale: number): void {
  phase = frame === null || mode !== "live" ? STILL_PHASE : boilPhase(frame);
  S = scale;
}

/** Amplitude 0 makes inkCtx a pure pass-through, which is how static art opts out. */
export function setInk(amp: number, key = 0): void {
  inkAmp = mode === "off" ? 0 : amp;
  inkKey = key;
}

function hashN(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* c = 46 DESIGN units is the wobble's wavelength: smaller reads tight/busy,
 * larger reads as lazy waves. */
function vnoise(x: number, seed: number): number {
  const c = 46;
  const i = Math.floor(x / c);
  const t = x / c - i;
  const a = hashN(i, seed);
  const b = hashN(i + 1, seed);
  const u = (1 - Math.cos(t * Math.PI)) / 2; // cosine interp = soft lattice
  return a + (b - a) * u;
}

/* The phase shifts the SEED (+7.31), so each phase is a genuinely different
 * tracing of the same shape - not the same wobble slid sideways. */
function jit(x: number, seed: number, amp: number): number {
  return (vnoise(x, seed + phase * 7.31) - 0.5) * 2 * amp;
}

/* Print misregistration for a bitmap, in device px.
 *
 * It reads the same `phase` as the linework, so it follows the mode for free:
 * a still gets the middle phase's fixed offset and a live one cycles. The bible
 * draws exactly this line - "static offset for props/stills, boiling offset for
 * things that are alive". */
export function misregOffset(scale: number): { dx: number; dy: number } {
  if (mode === "off") return { dx: 0, dy: 0 };
  const a = BOIL.misreg * scale;
  const table = [
    [a * 0.35, a * 0.3],
    [a * 0.9, -a * 0.7],
    [-a * 0.6, a * 0.8],
  ];
  return { dx: table[phase][0], dy: table[phase][1] };
}

type PathOverrides = Pick<
  CanvasRenderingContext2D,
  "beginPath" | "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "arc"
>;

/* Wraps a 2D context so ordinary drawing code boils without knowing it. Two
 * jobs: offset every emitted point by noise, and subdivide long segments so
 * lines bow instead of tilting - a straight line jittered only at its endpoints
 * just tilts. */
export function inkCtx(base: CanvasRenderingContext2D): CanvasRenderingContext2D {
  let hp = false;
  let lx = 0;
  let ly = 0;

  /* WORLD-STABLE noise key: undo the stage scale, re-add the layer's scroll,
   * fold in y so vertical runs wobble too. Keying on screen position makes the
   * wobble crawl; keying on time alone makes the whole shape shiver as one and
   * reads as an earthquake. */
  const K = (x: number, y: number) => x / S + inkKey + (y / S) * 0.37;

  const pt = (x: number, y: number, start: boolean) => {
    const k = K(x, y);
    const jx = x + jit(k, 58.2, inkAmp) * S;
    const jy = y + jit(k, 91.7, inkAmp) * S;
    if (start && !hp) base.moveTo(jx, jy);
    else base.lineTo(jx, jy);
    hp = true;
  };

  // SUBDIVIDE: roughly every 16 design px.
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay);
    const N = Math.max(1, Math.min(14, Math.round(L / (16 * S))));
    for (let i = 1; i <= N; i++) pt(ax + ((bx - ax) * i) / N, ay + ((by - ay) * i) / N, false);
  };

  const over: PathOverrides = {
    beginPath() {
      hp = false;
      base.beginPath();
    },
    moveTo(x: number, y: number) {
      const k = K(x, y);
      base.moveTo(x + jit(k, 58.2, inkAmp) * S, y + jit(k, 91.7, inkAmp) * S);
      hp = true;
      lx = x;
      ly = y;
    },
    lineTo(x: number, y: number) {
      if (!hp) over.moveTo(x, y);
      else {
        seg(lx, ly, x, y);
        lx = x;
        ly = y;
      }
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const L = Math.hypot(cx - lx, cy - ly) + Math.hypot(x - cx, y - cy);
      const N = Math.max(3, Math.min(16, Math.round(L / (14 * S))));
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        pt(u * u * lx + 2 * u * t * cx + t * t * x, u * u * ly + 2 * u * t * cy + t * t * y, false);
      }
      lx = x;
      ly = y;
    },
    bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number) {
      // Sample by hull length: short traced splines want ~2 samples, long
      // sweeps want ~10 or the curve visibly facets.
      const L =
        Math.hypot(ax - lx, ay - ly) + Math.hypot(bx - ax, by - ay) + Math.hypot(x - bx, y - by);
      const N = Math.max(2, Math.min(20, Math.round(L / (3.5 * S))));
      for (let i = 1; i <= N; i++) {
        const t = i / N;
        const u = 1 - t;
        pt(
          u * u * u * lx + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
          u * u * u * ly + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y,
          false,
        );
      }
      lx = x;
      ly = y;
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw?: boolean) {
      let d = a1 - a0;
      if (ccw) {
        if (d > 0) d -= Math.PI * 2;
      } else if (d < 0) d += Math.PI * 2;
      const N = Math.max(6, Math.min(26, Math.round((Math.abs(d) * r) / (11 * S))));
      for (let i = 0; i <= N; i++) {
        const a = a0 + (d * i) / N;
        pt(cx + Math.cos(a) * r, cy + Math.sin(a) * r, i === 0);
      }
      lx = cx + Math.cos(a0 + d) * r;
      ly = cy + Math.sin(a0 + d) * r;
    },
  };

  const bound: Record<string, unknown> = {};
  return new Proxy(base, {
    get(t, p: string) {
      if (inkAmp && p in over) return over[p as keyof PathOverrides];
      const c = bound[p];
      if (c !== undefined) return c;
      const v = (t as unknown as Record<string, unknown>)[p];
      if (typeof v === "function") {
        const b = (v as (...a: unknown[]) => unknown).bind(t);
        bound[p] = b;
        return b;
      }
      return v;
    },
    set(t, p: string, v) {
      (t as unknown as Record<string, unknown>)[p] = v;
      return true;
    },
  }) as CanvasRenderingContext2D;
}

/* ------------------------------------------------------------ curtain wipe */

/* The standard transition: Box1's torn edge dragged across the frame. The
 * bible's rules, all three learned in the game: FEW BIG TEETH (many small ones
 * read as serration, not a tear), ONE CONTINUOUS PULL in one direction (a wipe
 * that backs up over itself reads as a loading bar), and the teeth boil on the
 * same clock as everything else.
 *
 * `progress` runs 0 (frame fully covered) to 1 (curtain gone), pulling right.
 */
const TEETH = 6;

export function drawCurtain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  color: string,
): void {
  if (progress >= 1) return;
  const rake = w * 0.13; // the edge is raked, not vertical
  const tooth = w * 0.075;
  /* The cloth lies to the RIGHT of its edge and the edge travels right, so the
   * frame UNCOVERS as progress rises. The span is set so that at progress 0 the
   * edge's rightmost point is still at x=0 (nothing showing) and at progress 1
   * its leftmost point has passed w (nothing left). */
  const lead = rake + tooth;
  const base = -lead + progress * (w + lead);

  const edgeX = (t: number, i: number) =>
    base + rake * (1 - t) + (i % 2 === 0 ? tooth : 0);

  const ink = inkCtx(ctx);
  setInk(BOIL.curtain * 6, 0);
  ink.beginPath();
  ink.moveTo(w * 2, -h * 0.05);
  ink.lineTo(edgeX(0, 0), -h * 0.05);
  for (let i = 0; i <= TEETH; i++) {
    const t = i / TEETH;
    // Alternate deep and shallow so the tear has a few big teeth, not a saw.
    ink.lineTo(edgeX(t, i), h * t);
  }
  ink.lineTo(edgeX(1, TEETH), h * 1.05);
  ink.lineTo(w * 2, h * 1.05);
  ink.closePath();
  setInk(0);
  ctx.fillStyle = color;
  ctx.fill();
}
