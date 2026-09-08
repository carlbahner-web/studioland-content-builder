/* Snapping, and the guides that explain it.
 *
 * Placing by eye at a preview scale is placing by eye at a quarter size: a
 * headline you centre on a 270px preview is up to four artboard pixels off in
 * the export, which is exactly the sort of error that is invisible until it is
 * printed. Snapping removes it, and the guide is what stops the snap feeling
 * like the tool fighting you - a line appears saying WHY it moved, and holding
 * a modifier turns it off.
 *
 * What is snapped to, in the order a designer would reach for it: the
 * artboard's centre lines, its safe margin, its edges, and then the edges and
 * centres of everything else already placed.
 *
 * Everything here is device pixels on one artboard and pure - no canvas, no
 * state - so the thresholds can be tested rather than eyeballed.
 */

export type Box = { cx: number; cy: number; w: number; h: number };

/** A line to draw, in device pixels along one axis. */
export type Guide = { axis: "x" | "y"; at: number };

export type SnapTargets = { x: number[]; y: number[] };

/* Within this fraction of the SHORT edge, a candidate snaps. At 1080 that is
 * about 9px on the artboard - a couple of pixels at preview scale, so it catches
 * an intended alignment without grabbing at a deliberate near-miss. */
export const SNAP_FRACTION = 0.008;

export function snapThreshold(w: number, h: number): number {
  return Math.min(w, h) * SNAP_FRACTION;
}

/** The lines worth snapping to on an artboard, given what else is on it. */
export function snapTargets(w: number, h: number, margin: number, others: Box[]): SnapTargets {
  const x = [w / 2, margin, w - margin, 0, w];
  const y = [h / 2, margin, h - margin, 0, h];
  for (const b of others) {
    x.push(b.cx, b.cx - b.w / 2, b.cx + b.w / 2);
    y.push(b.cy, b.cy - b.h / 2, b.cy + b.h / 2);
  }
  return { x, y };
}

/* Snap one box, one axis at a time.
 *
 * Three of the box's own lines are candidates on each axis - its two edges and
 * its centre - and the smallest correction inside the threshold wins. Both axes
 * are resolved independently, so a box can snap its left edge to a neighbour
 * while its centre snaps to the artboard's middle, which is the case that makes
 * snapping worth having at all.
 *
 * A ROTATED box passes w and h of 0: its axis-aligned bounds are not its edges
 * any more, so snapping them would align something that is not there. Its centre
 * still snaps, which is the part that stays true under rotation.
 */
export function snapBox(box: Box, targets: SnapTargets, threshold: number): {
  cx: number;
  cy: number;
  guides: Guide[];
} {
  const one = (centre: number, extent: number, lines: number[]) => {
    let best: { delta: number; at: number } | null = null;
    for (const offset of [-extent / 2, 0, extent / 2]) {
      for (const at of lines) {
        const delta = at - (centre + offset);
        if (Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at };
      }
    }
    return best;
  };

  const gx = one(box.cx, box.w, targets.x);
  const gy = one(box.cy, box.h, targets.y);
  const guides: Guide[] = [];
  if (gx) guides.push({ axis: "x", at: gx.at });
  if (gy) guides.push({ axis: "y", at: gy.at });
  return {
    cx: box.cx + (gx?.delta ?? 0),
    cy: box.cy + (gy?.delta ?? 0),
    guides,
  };
}
