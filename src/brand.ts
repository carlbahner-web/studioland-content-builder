/* The StudioLand palette, the sanctioned colorways, and the output sizes.
 *
 * Every value here is copied from SL_REF_Visual_Brand_Bible_v5 (in the
 * `wild-ride` repo) and from `design-system/tokens/studioland.css`, which is
 * the canonical token file. One value per color, everywhere. If something
 * here ever disagrees with that file, this file is the one that is wrong.
 *
 * The point of the generator is that a teammate cannot make a bad choice, so
 * the bible's rules live here as DATA rather than as guidance someone has to
 * remember: which grounds are legal, which ink goes on them, and which action
 * color survives on which field.
 */

export const PALETTE = {
  charcoal: "#2C2C2A",
  offwhite: "#fcf7e8",
  harborTeal: "#3A6168",
  rusty: "#BF7538",
  mustard: "#F6CC60",
  foggyMint: "#BFCDC0",
  red: "#c05838",
  neonGreen: "#50ad33",
  ctaRed: "#FE3636",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/* Locked tracking, proven in the Blueprint build. Expressed in em so it can be
 * multiplied by a font size at draw time. */
export const TRACKING = {
  body: -0.1,
  caps: 0.08,
  display: 0.02,
} as const;

export const LEADING_BODY = 1.82;

/* ---------------------------------------------------------------- luminance */

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/* The value-gap rule (bible 1.1). Adjacent fields read when they sit roughly
 * 0.17 luminance apart. This was measured, not guessed: the game's calm palette
 * read at a 0.17 gap and its first vivid palette failed at 0.08 — trees
 * dissolved into the sky — and was fixed by matching the gap with no other
 * change. Hues are free; the value gap is the contract. */
export const VALUE_GAP = 0.17;

export function valueGap(a: string, b: string): number {
  return Math.abs(luminance(a) - luminance(b));
}

export function readsAgainst(a: string, b: string): boolean {
  return valueGap(a, b) >= VALUE_GAP;
}

/** Hue angle in degrees, 0-360. */
export function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Shortest distance between two hue angles, 0-180. */
export function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

export const HUE_GAP = 60;

/* An action color reads on a ground if it separates EITHER on value or on hue.
 *
 * This is the bible's "hue can succeed where contrast math fails" (1.1), and it
 * is not a softening of the value-gap rule — it is a different rule for a
 * different job. The value gap governs adjacent FIELDS in a layered image, where
 * two flat areas of the same lightness dissolve into each other whatever their
 * hues. A CTA badge is not a field: it is a small, outlined, high-saturation
 * object, and there hue does the separating.
 *
 * Both of the game's measured cases fall out of this correctly, which is why the
 * rule is written this way rather than as a blanket threshold:
 *   - Alert Red on a rust ground: value 0.00, hue 28 deg  -> fails, and it
 *     measured 1.23:1 in practice. Invisible.
 *   - Neon Green on that same rust ground: value 0.08, hue 75 deg -> passes,
 *     and it popped.
 * A pure value-gap test would have rejected both; a pure contrast ratio would
 * have rejected both. Only the pair of rules matches what was actually seen.
 */
export function ctaReads(cta: string, ground: string): boolean {
  return valueGap(cta, ground) >= VALUE_GAP || hueGap(cta, ground) >= HUE_GAP;
}

/* Which ink a boiled badge or starburst outlines itself in. Trap #6 of the boil
 * recipe, paid for twice in the game: charcoal ink on a charcoal-ish field
 * disappears and the boil has nothing to show. Cream on dark grounds. */
export function inkFor(ground: string): "charcoal" | "offwhite" {
  return luminance(ground) < 0.2 ? "offwhite" : "charcoal";
}

/* ---------------------------------------------------------------- colorways */

export type Colorway = {
  key: string;
  label: string;
  /** The dominant ground. The 60 of 60/30/10. */
  ground: PaletteKey;
  /** Headline fill. */
  ink: PaletteKey;
  /** Headline outline, or null where the fill already carries the ground. */
  outline: PaletteKey | null;
  /** Keyword pops and emphasis. The 10. */
  accent: PaletteKey;
  /** Which action colors survive on this ground, best first. */
  ctas: PaletteKey[];
  /** Which wordmark build to place. */
  wordmark: "charcoal" | "cream";
};

/* Grounds are limited to the four the bible names as dominant ("usually
 * Charcoal, BUZZ Off-White, Harbor Teal, or Rusty Turnstile") plus brand RED,
 * which it gives to "hot" energy. Mustard, Neon Green and CTA Red are never
 * grounds — mustard is a highlight and the other two are reserved for things
 * people should click or notice.
 *
 * CTA Red is deliberately absent from the warm grounds. Alert Red on a rust
 * ground measured 1.23:1 — invisible. Green at a similar luminance popped
 * because it separates on HUE rather than on contrast. That is the whole
 * "we wouldn't put a green button on a blue background" idea, inverted and
 * made enforceable: on a warm ground you get green, and the option to get it
 * wrong is not offered. */
export const COLORWAYS: Colorway[] = [
  {
    key: "teal",
    label: "Harbor Teal",
    ground: "harborTeal",
    ink: "offwhite",
    outline: "charcoal",
    accent: "mustard",
    ctas: ["neonGreen", "ctaRed"],
    wordmark: "cream",
  },
  {
    key: "rusty",
    label: "Rusty Turnstile",
    ground: "rusty",
    ink: "offwhite",
    outline: "charcoal",
    accent: "mustard",
    ctas: ["neonGreen"],
    wordmark: "cream",
  },
  {
    key: "charcoal",
    label: "Charcoal",
    ground: "charcoal",
    ink: "offwhite",
    outline: null,
    accent: "mustard",
    ctas: ["neonGreen", "ctaRed"],
    wordmark: "cream",
  },
  {
    key: "cream",
    label: "BUZZ Off-White",
    ground: "offwhite",
    ink: "charcoal",
    outline: null,
    accent: "rusty",
    ctas: ["neonGreen", "ctaRed"],
    wordmark: "charcoal",
  },
  {
    key: "red",
    label: "Brand Red (hot)",
    ground: "red",
    ink: "offwhite",
    outline: "charcoal",
    accent: "mustard",
    ctas: ["neonGreen"],
    wordmark: "cream",
  },
];

/* ------------------------------------------------------------------ formats */

/* Formats are named for the JOB, not the ratio.
 *
 * Nobody making a hiring post thinks "I need a 1080x1350"; they think "this
 * goes in the feed". Naming these numerically pushes the translation onto the
 * person using the tool, every single time, which is exactly the sort of small
 * tax this whole thing exists to remove. The pixel size is still shown, because
 * it is worth knowing when an upload form asks - but it is the caption, not the
 * name.
 *
 * Adding one is a line here. The template lays out by ASPECT, not by key, so a
 * new format composes correctly without touching the drawing code.
 */
export type Format = {
  key: string;
  /** What it is for. This is the label. */
  label: string;
  /** Where it ends up. Shown small, under the label. */
  where: string;
  w: number;
  h: number;
};

export const FORMATS: Format[] = [
  { key: "post", label: "Instagram post", where: "Square feed post", w: 1080, h: 1080 },
  {
    key: "portrait",
    label: "Instagram portrait",
    where: "Takes the most feed space",
    w: 1080,
    h: 1350,
  },
  { key: "story", label: "Story / Reel", where: "Full screen, vertical", w: 1080, h: 1920 },
  { key: "thumbnail", label: "YouTube thumbnail", where: "Video cover", w: 1280, h: 720 },
  { key: "link", label: "Link preview", where: "Website, email, LinkedIn", w: 1200, h: 630 },
];

export const BUZZ_POSES = [
  { key: "wave", label: "Waving", src: "/brand/buzz-wave.webp" },
  { key: "ride", label: "In the car", src: "/brand/buzz-ride.webp" },
  { key: "none", label: "No BUZZ", src: null },
] as const;

export type BuzzPose = (typeof BUZZ_POSES)[number]["key"];
