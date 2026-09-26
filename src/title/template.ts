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
 * the size and the position all follow from those words and the safe box. The
 * banner does not: it is the same on every reel. A title that is typed with Enter keeps the breaks it was
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

export type Box = { x: number; y: number; w: number; h: number };

/* THE SAFE BOX: the one rectangle every letter of a title must land inside.
 *
 * Each edge is a decision, and each is written down here so it can be changed
 * in one place rather than rediscovered:
 *
 *   top     220  Measured off a screenshot of her own reel: Instagram's back
 *                arrow and camera button end ~200px down the 1920px frame.
 *                Chosen over Meta's blanket 14% (270px), which also allows for
 *                ads, to keep the banner off more of her face.
 *   sides    65  Meta's 6% side margin, on each side.
 *   bottom  440  How far down a title may reach. This is the choice that keeps
 *                the banner off her face - 220px of type is enough for four
 *                lines, and the banner ends 50px below it, at about a quarter
 *                of the frame.
 *
 * The banner is NOT held inside the box. It runs from the top edge of the frame
 * to BANNER_BOTTOM, so Instagram's buttons sit on navy rather than on video. */
export const SAFE_BOX: Box = { x: 65, y: 220, w: 950, h: 220 };

/* The banner is the same height on every reel, whatever the title, so a feed of
 * them reads as a series. Its bottom edge is 50px below the safe box: close to
 * the box's 65px side margins, so the navy frames the type about evenly. */
export const BANNER_PAD = 50;
export const BANNER_BOTTOM = SAFE_BOX.y + SAFE_BOX.h + BANNER_PAD;

/* The type's range. The ceiling is what a short title ("SOLD" or "OPEN HOUSE")
 * sets at, so it reads as a title and not a billboard; the floor is the point
 * past which a title is really a caption and should be cut. */
export const MAX_SIZE = 118;
export const MIN_SIZE = 36;

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

/** Cream type, from the listing art's strapline. */
export const TYPE_INK = INK;
/** The banner's flat navy, laid under the peony paper. */
export const BANNER_NAVY = OUTLINE;

export type TitleLine = {
  text: string;
  /** Centre of the line, in canvas px. */
  x: number;
  /** Alphabetic baseline, in canvas px. */
  y: number;
  /** Advance width at the chosen size, including tracking. */
  w: number;
};

export type TitleLayout = {
  lines: TitleLine[];
  size: number;
  /** The ink of the whole block - cap top of the first line to baseline of the
   *  last, widest line's width - in canvas px. Always inside SAFE_BOX. */
  ink: Box;
  /** Whether the breaks came from the words or from the person typing Enter. */
  manual: boolean;
};

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
const INSIDE_COST = 0.2;

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

/* The size a set of lines can be drawn at: as big as fits the safe box both
 * ways, and under the ceiling. Advance width is linear in size
 * once tracking is expressed in em, so one measurement at a reference size
 * stands in for a search. */
const REF = 100;

function sizeFor(lines: string[], measure: Measure): number {
  const widest = Math.max(...lines.map((l) => measure(l, REF, TRACKING)));
  const byWidth = widest > 0 ? (SAFE_BOX.w / widest) * REF : MAX_SIZE;
  const byHeight = SAFE_BOX.h / (CAP_RATIO + (lines.length - 1) * PITCH);
  return Math.min(MAX_SIZE, byWidth, byHeight);
}

/* The last word on near-ties: evenly matched lines. "PET / OWNERS: / TO FENCE
 * OR NOT TO FENCE?" and "PET OWNERS: / TO FENCE / OR NOT TO FENCE?" set at the
 * same size and both break after the colon, and without this the first one
 * found - the lopsided one - wins. Small enough that it never outweighs a real
 * difference in size or a better break. */
const RAG_COST = 0.03;

function score(lines: string[], size: number, measure: Measure): number {
  let k = 1;
  const widths = lines.map((l) => measure(l, REF, TRACKING));
  const widest = Math.max(...widths);
  if (lines.length > 1 && widest > 0) k -= RAG_COST * (1 - Math.min(...widths) / widest);
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
      const s = score(lines, size, measure);
      // Strictly better only, so the fewer-lines candidate found first keeps a tie.
      if (!best || s > best.score + 0.01) best = { lines, size, score: s };
    }
  }
  return { lines: best!.lines, size: Math.max(MIN_SIZE, best!.size), manual: false };
}

/* A few different ways to break the same words, best first, for someone to
 * pick between by eye rather than by typing line breaks.
 *
 * One per line count - the best two-line break, the best three-line break and
 * so on - because two breaks with the same number of lines mostly look alike,
 * and a choice between near-twins is not a choice. Anything that would set the
 * type much smaller than the best is left out; it is never the better picture.
 * The first is always the one breakTitle would have chosen. Typed breaks are
 * the only choice there is. */
export function titleChoices(text: string, measure: Measure, max = 3): string[][] {
  const t = clean(text);
  if (!t) return [];
  if (t.includes("\n")) return [t.split("\n").filter(Boolean)];

  const words = t.split(" ");
  const perCount: { lines: string[]; size: number; score: number }[] = [];
  for (let n = 1; n <= Math.min(MAX_LINES, words.length); n++) {
    let best: { lines: string[]; size: number; score: number } | null = null;
    for (const lines of partitions(words, n)) {
      const size = sizeFor(lines, measure);
      const s = score(lines, size, measure);
      if (!best || s > best.score + 0.01) best = { lines, size, score: s };
    }
    if (best) perCount.push(best);
  }
  // Best first; near-ties go to fewer lines, the same rule breakTitle uses.
  perCount.sort((a, b) =>
    Math.abs(a.score - b.score) <= 0.01 ? a.lines.length - b.lines.length : b.score - a.score,
  );
  const top = perCount[0].size;
  return perCount
    .filter((c) => c.size >= top * 0.7)
    .slice(0, max)
    .map((c) => c.lines);
}

/* ------------------------------------------------------------ the placing */

/* Everything, in canvas terms.
 *
 * The block is centred in the safe box both ways. Vertically that means the INK
 * is centred - from the top of the first line's capitals to the baseline of the
 * last - not the em boxes, which carry space above the caps and below the
 * baseline that nobody can see, and would sit a short title visibly high.
 *
 * Centred rather than hung from the top, because the banner no longer grows
 * with the title: a one-word title in a fixed banner, pushed to the top of it,
 * leaves a band of empty navy underneath that reads as a mistake.
 */
export function layoutTitle(text: string, measure: Measure): TitleLayout {
  const { lines, size, manual } = breakTitle(text, measure);
  const pitch = size * PITCH;
  const cap = size * CAP_RATIO;
  const cx = SAFE_BOX.x + SAFE_BOX.w / 2;

  const widths = lines.map((l) => measure(l, size, TRACKING));
  const h = lines.length ? cap + (lines.length - 1) * pitch : 0;
  const w = Math.max(0, ...widths);
  const top = SAFE_BOX.y + (SAFE_BOX.h - h) / 2;

  return {
    lines: lines.map((t, i) => ({ text: t, x: cx, y: top + cap + i * pitch, w: widths[i] })),
    size,
    ink: { x: cx - w / 2, y: top, w, h },
    manual,
  };
}

/* A file name that sorts by date and says what it is:
 * "Sep26 reel title Pet owners fence.png".
 *
 * Month and day first, so a Downloads folder full of them lines up in the order
 * they were made; then "reel title", so it is obvious what it is next to a
 * listing post; then the first three words that carry the meaning, skipping the
 * small ones (a, the, to, or...) that would make every name start the same way.
 * Words keep the capitals she typed them with. Anything Windows refuses in a
 * file name never gets in, because only letters, digits, apostrophes and
 * hyphens survive from each word. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FILLER = new Set([...DANGLERS].map((w) => w.toLowerCase()).concat(["but", "so", "are", "be"]));

export function filenameFor(text: string, when: Date = new Date()): string {
  const date = `${MONTHS[when.getMonth()]}${String(when.getDate()).padStart(2, "0")}`;
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, "").replace(/^[-'’]+|[-'’]+$/g, ""))
    .filter((w) => w && !FILLER.has(w.toLowerCase()))
    .slice(0, 3);
  return [date, "reel title", ...words].join(" ") + ".png";
}

export const SEED = "Pet owners: to fence or not to fence?";
