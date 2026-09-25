/* The reel title: where it sits, and the arithmetic that gets it there.
 *
 * What this makes is a full-frame, 1080x1920, mostly-transparent PNG: the navy
 * peony banner across the top of a reel with the title set on it, and nothing
 * anywhere else. Full frame on purpose. A banner-only crop has to be positioned
 * and scaled by hand in whatever app the video is edited in, which is exactly
 * the fiddling this exists to remove; a full-frame overlay drops onto the
 * timeline and lands where it belongs, because it is the same size as the video.
 *
 * Nothing here is a control. The person using it types words; the line breaks,
 * the size and the height of the banner all follow from those words and the
 * space available. A title that is typed with Enter keeps the breaks it was
 * given - that is the one override, and it is the one people reach for.
 *
 * Kept free of DOM and canvas so the layout can be tested at a desk.
 */
import { CAP_RATIO, FONT_FAMILY, INK, OUTLINE, TRACKING as LISTING_TRACKING } from "../listing/template.ts";
import type { Measure } from "../listing/template.ts";

/* The same Measure the listing builder uses, with one difference in contract:
 * here it returns the width WITHOUT the letter-space canvas adds after the last
 * glyph, because centring and fitting are both about the ink. draw.ts's
 * titleMeasurer is the one that does that, and knows whether the browser applied
 * tracking at all. */
export type { Measure };
export { CAP_RATIO, FONT_FAMILY };

/** A reel. Instagram, TikTok and Shorts all take 9:16 at this size. */
export const CANVAS = { w: 1080, h: 1920 } as const;

/* Where Instagram's own buttons stop.
 *
 * Measured off a screenshot of the reel this was drawn for: the back arrow and
 * the camera button sit over the top of the video and finish ~200px down the
 * 1920px frame, and the phone's clock and camera cut-out sit above them. Every
 * letter of the title has to land below this line. The banner itself is NOT
 * held below it - it runs off the top edge, the way the original does, so the
 * buttons sit on navy rather than on her face. */
export const SAFE_TOP = 220;

/* The tilt. The original's banner climbs about 5 degrees to the right, but its
 * three lines were each set at a slightly different angle; here the banner and
 * every line share one, a little shallower so a long single line does not climb
 * far enough to look like it is sliding off. Negative is up to the right. */
export const ANGLE_DEG = -4;

/** Clear space between the type and each side of the frame. */
export const SIDE = 72;

/* The type's range. The ceiling is what a short title ("SOLD" or "OPEN HOUSE")
 * sets at, so it reads as a title and not a billboard; the floor is the point
 * past which a title is really a caption and should be cut. */
export const MAX_SIZE = 118;
export const MIN_SIZE = 36;

/* How tall the block of type may get. This is the number that decides whether a
 * long title goes to three lines or four, and it is what keeps the banner off
 * her face: with a 3-line title the banner ends a little under a third of the
 * way down, about where the original's did. */
export const MAX_TEXT_H = 240;

/** Most lines a title is broken into automatically. */
export const MAX_LINES = 4;

/** Baseline to baseline, in em. Caps only, so it can sit tighter than text. */
export const PITCH = 1.16;

/* The listing posts' tracking, not the reel's. The reel was the idea - a title
 * banner over the video - and not the look to copy: its wide, airy spacing was
 * a different face and a different treatment. Set like the address on her
 * listing posts, a title reads as the same brand in her feed.
 */
export const TRACKING = LISTING_TRACKING;

/** Navy below the last line, above the banner's bottom edge. */
export const PAD_BOTTOM = 48;

/** Cream type, from the listing art's strapline. */
export const TYPE_INK = INK;
/** The banner's flat navy, laid under the peony paper. */
export const BANNER_NAVY = OUTLINE;

export type Point = { x: number; y: number };

export type TitleLine = {
  text: string;
  /** Centre of the line, in the banner's own (unrotated) frame. */
  x: number;
  /** Alphabetic baseline, in the banner's own frame. */
  y: number;
  /** Advance width at the chosen size, including tracking. */
  w: number;
};

export type TitleLayout = {
  lines: TitleLine[];
  size: number;
  /** The point the banner turns about, in canvas px. */
  pivot: Point;
  /** Radians. */
  angle: number;
  /** The banner's bottom edge, in the banner's own frame. */
  bottom: number;
  /** Whether the breaks came from the words or from the person typing Enter. */
  manual: boolean;
};

const RAD = (ANGLE_DEG * Math.PI) / 180;

/* ------------------------------------------------------------- the words */

/* Caps, always: the design is set in capitals, and a title half-typed in lower
 * case would otherwise come out looking like a different template. Runs of
 * spaces collapse, because nobody means two spaces in a title and the tracking
 * already makes one look generous. */
export function clean(text: string): string {
  return text
    .toUpperCase()
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

/* Lines that end on one of these read as if the sentence fell off the edge -
 * "PET OWNERS: TO / FENCE OR NOT / TO FENCE?" - so a break after one costs a
 * little. A break after punctuation is where a person would put it, so that
 * earns a little. Neither can beat a real difference in size; they only decide
 * between breaks that are near enough the same. */
const DANGLERS = new Set([
  "A", "AN", "THE", "TO", "OR", "AND", "OF", "FOR", "IN", "ON", "AT", "IS",
  "MY", "YOUR", "WITH", "BY", "FROM", "&",
]);
const BREAK_BONUS = 0.06;
const DANGLE_COST = 0.06;
/* And the other side of the same rule: a colon or question mark in the MIDDLE
 * of a line - "PET OWNERS: TO FENCE" - is a break that should have happened
 * and did not. Weighted a little more, because it reads worse than a line that
 * is merely a bit smaller. */
const INSIDE_COST = 0.1;

/* Every way to put `words` on `n` lines, in order. A title is a handful of
 * words and n is at most four, so exhaustive is cheap - twenty words is under a
 * thousand candidates - and exhaustive is the only way to be sure the most
 * balanced break is the one that wins. */
function* partitions(words: string[], n: number): Generator<string[]> {
  if (n === 1) {
    yield [words.join(" ")];
    return;
  }
  for (let i = 1; i <= words.length - n + 1; i++) {
    const head = words.slice(0, i).join(" ");
    for (const rest of partitions(words.slice(i), n - 1)) yield [head, ...rest];
  }
}

/* The size a set of lines can be drawn at: as big as fits across the frame,
 * down the height budget, and under the ceiling. Advance width is linear in size
 * once tracking is expressed in em, so one measurement at a reference size
 * stands in for a search. */
const REF = 100;

function sizeFor(lines: string[], measure: Measure): number {
  const widest = Math.max(...lines.map((l) => measure(l, REF, TRACKING)));
  const byWidth = widest > 0 ? ((CANVAS.w - SIDE * 2) / widest) * REF : MAX_SIZE;
  const byHeight = MAX_TEXT_H / (CAP_RATIO + (lines.length - 1) * PITCH);
  return Math.min(MAX_SIZE, byWidth, byHeight);
}

function score(lines: string[], size: number): number {
  let k = 1;
  for (const line of lines.slice(0, -1)) {
    if (/[:,.?!;—–-]$/.test(line)) k += BREAK_BONUS;
    const last = line.split(" ").pop() ?? "";
    if (DANGLERS.has(last)) k -= DANGLE_COST;
  }
  for (const line of lines) if (/[:;?!.] /.test(line)) k -= INSIDE_COST;
  return size * k;
}

/* The breaks and the size, before anything is placed.
 *
 * Typed breaks are kept as typed and only sized; otherwise every break of every
 * line count is tried and the one that lets the type be biggest wins. Bigger is
 * the right proxy for "best" here: a break that leaves one long line and one
 * short forces the whole title down to the long line's size, so maximising the
 * size is the same thing as balancing the lines. Ties go to fewer lines. */
export function breakTitle(text: string, measure: Measure): { lines: string[]; size: number; manual: boolean } {
  const t = clean(text);
  if (!t) return { lines: [], size: MAX_SIZE, manual: false };

  if (t.includes("\n")) {
    const lines = t.split("\n").filter(Boolean);
    return { lines, size: Math.max(MIN_SIZE, sizeFor(lines, measure)), manual: true };
  }

  const words = t.split(" ");
  let best: { lines: string[]; size: number; score: number } | null = null;
  for (let n = 1; n <= Math.min(MAX_LINES, words.length); n++) {
    for (const lines of partitions(words, n)) {
      const size = sizeFor(lines, measure);
      const s = score(lines, size);
      // Strictly better only, so the fewer-lines candidate found first keeps a tie.
      if (!best || s > best.score + 0.01) best = { lines, size, score: s };
    }
  }
  return { lines: best!.lines, size: Math.max(MIN_SIZE, best!.size), manual: false };
}

/* ------------------------------------------------------------ the placing */

/* Everything, in canvas terms.
 *
 * The banner and its type are laid out flat, in the banner's own frame, and the
 * whole frame is then turned about a pivot at the centre of the type's top edge.
 * The type's top is set as high as it can go with no letter crossing SAFE_TOP
 * once turned - which is the top line's right-hand end, since the banner climbs
 * to the right - so the title always sits as close under Instagram's buttons as
 * it safely can, whatever its length.
 */
export function layoutTitle(text: string, measure: Measure): TitleLayout {
  const { lines, size, manual } = breakTitle(text, measure);
  const pitch = size * PITCH;
  const cap = size * CAP_RATIO;
  const cx = CANVAS.w / 2;

  const widths = lines.map((l) => measure(l, size, TRACKING));

  /* Turning about (cx, top), a point dx right of centre and dy below the top
   * rises by dx*sin and drops by dy*cos. The top of line i's caps is at dy =
   * i*pitch, and its highest point is its right-hand end. */
  const sin = Math.sin(RAD);
  const cos = Math.cos(RAD);
  let rise = 0;
  widths.forEach((w, i) => {
    rise = Math.max(rise, -((w / 2) * sin + i * pitch * cos));
  });
  const top = SAFE_TOP + Math.max(0, rise);

  return {
    lines: lines.map((t, i) => ({ text: t, x: cx, y: top + cap + i * pitch, w: widths[i] })),
    size,
    pivot: { x: cx, y: top },
    angle: RAD,
    bottom: top + cap + Math.max(0, lines.length - 1) * pitch + PAD_BOTTOM,
    manual,
  };
}

/** A point in the banner's frame, turned into canvas px. */
export function toCanvas(layout: TitleLayout, p: Point): Point {
  const { pivot, angle } = layout;
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

/* The lowest the banner reaches, in canvas px: the left end of its bottom edge,
 * since it climbs to the right. What decides how much of the video it covers. */
export function bannerLowest(layout: TitleLayout): number {
  const left = toCanvas(layout, { x: 0, y: layout.bottom });
  const right = toCanvas(layout, { x: CANVAS.w, y: layout.bottom });
  return Math.max(left.y, right.y);
}

/** A title turned into something a file can be called. */
export function filenameFor(text: string): string {
  const slug = clean(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
  return `${slug || "reel"}-title.png`;
}

export const SEED = "Pet owners: to fence or not to fence?";
