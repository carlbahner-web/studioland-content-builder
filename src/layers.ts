/* Free layers - the thing you add, rather than the thing the template placed.
 *
 * The template still owns five named elements (headline, supporting line, CTA,
 * BUZZ, wordmark) and composes them per format, which is what makes a new design
 * on-brand in one second. That is worth keeping, so it was kept. What it cannot
 * do is let you put a second block of text somewhere, or a rule under a word, or
 * three photos in a row - and a tool meant to replace a general-purpose design
 * app has to.
 *
 * So a design is now the template PLUS an ordered list of layers drawn over it.
 * Both kinds are selected, dragged, resized and rotated by the same machinery;
 * the difference is only that a template element falls back to a computed
 * position when it has no transform of its own, and a layer always knows where
 * it is.
 *
 * TWO CONVENTIONS HOLD FOR EVERY LAYER, and both are inherited from the sticker
 * rule they replace, for its reasons:
 *
 *  - Position is a FRACTION OF THE ARTBOARD, never pixels. That is what lets one
 *    placement mean something at all five sizes - an arrow put beside the
 *    headline in the square lands beside the headline in the story.
 *  - Size is a fraction of the artboard's SHORT edge, never its width. Sizing
 *    against the width makes everything balloon in the landscape.
 *
 * Colour is a PALETTE KEY, never a hex string. The point of the tool is that a
 * teammate cannot make an off-brand choice, and a free-text colour field is
 * exactly how one gets made. Everything a layer can be is something the bible
 * already sanctioned.
 */
import { PALETTE, type PaletteKey } from "./brand.ts";
import type { InkMode } from "./boil.ts";

/* ------------------------------------------------------------------- model */

export type LayerKind = "text" | "shape" | "image";

type Base = {
  id: string;
  kind: LayerKind;
  /** What the layers list calls it. Renameable; never used for anything else. */
  name: string;
  /** Centre, as a fraction of width and height. */
  x: number;
  y: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0 to 1. */
  opacity: number;
  /** Off the artboard but still in the list, so it can come back. */
  hidden: boolean;
  /** Cannot be selected on the artboard. Still editable from the list. */
  locked: boolean;
  /** Ink for this layer, or null to follow the design's setting. */
  ink: InkMode | null;
};

/** Which brand face. There are three and there will only ever be three. */
export type Face = "display" | "narrow" | "body";

export const FACES: { key: Face; label: string; family: string; tracking: number; lineHeight: number }[] = [
  { key: "display", label: "DW Fairfield", family: "DWFairfield", tracking: 0.02, lineHeight: 1.02 },
  { key: "narrow", label: "DW Fairfield Narrow", family: "DWFairfieldNarrow", tracking: 0.02, lineHeight: 1.04 },
  { key: "body", label: "TAY Wingman", family: "TAYWingman", tracking: -0.1, lineHeight: 1.82 },
];

export function faceOf(key: Face) {
  return FACES.find((f) => f.key === key) ?? FACES[0];
}

export type TextLayer = Base & {
  kind: "text";
  text: string;
  face: Face;
  /** Box width, as a fraction of the short edge. Text wraps to it. */
  w: number;
  /** Font size, as a fraction of the short edge. Set directly, not fitted -
   *  a free text box is where you want the size you asked for. */
  size: number;
  align: "left" | "center" | "right";
  color: PaletteKey;
  outline: PaletteKey | null;
  caps: boolean;
  /** Balance the wrap, as the template's headline does. Off by default: on a
   *  box you sized yourself, an even rag is a choice rather than a rescue. */
  balance: boolean;
};

/* The shapes are the brand's own devices, not a general shape library. The
 * starburst is here because it is the CTA badge - having it as a placeable
 * object is what lets you put a second one somewhere the template would not. */
export type ShapeKind = "rect" | "ellipse" | "line" | "starburst";

export const SHAPES: { key: ShapeKind; label: string }[] = [
  { key: "rect", label: "Rectangle" },
  { key: "ellipse", label: "Ellipse" },
  { key: "line", label: "Rule" },
  { key: "starburst", label: "Starburst" },
];

export type ShapeLayer = Base & {
  kind: "shape";
  shape: ShapeKind;
  /** Both fractions of the short edge, so a square is square everywhere. */
  w: number;
  h: number;
  fill: PaletteKey | null;
  stroke: PaletteKey | null;
  /** Stroke weight, as a fraction of the short edge. */
  strokeWidth: number;
  /** Corner radius for a rect, as a fraction of its shorter side, 0 to 0.5. */
  radius: number;
  /** The starburst's label. Empty draws the badge bare. */
  label: string;
};

export type ImageLayer = Base & {
  kind: "image";
  /** Key into the decoded-image map: a file name from the connected folder, or
   *  the id of something uploaded into this browser. */
  name: string;
  /** Where the bytes come from, so the UI can say what is missing and why. */
  src: "library" | "upload";
  /** Width, as a fraction of the short edge. Height follows the aspect. */
  w: number;
  flipX: boolean;
  flipY: boolean;
};

export type Layer = TextLayer | ShapeLayer | ImageLayer;

/* --------------------------------------------------------------- defaults */

/* Ids carry no meaning and are never parsed. Time plus randomness is enough:
 * the only requirement is that duplicating a layer in the same millisecond
 * cannot collide with it. */
export function layerId(): string {
  return `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const base = (kind: LayerKind, name: string): Base => ({
  id: layerId(),
  kind,
  name,
  x: 0.5,
  y: 0.5,
  rotation: 0,
  opacity: 1,
  hidden: false,
  locked: false,
  ink: null,
});

export function newText(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    ...(base("text", "Text") as Base & { kind: "text" }),
    kind: "text",
    text: "Double-click to edit",
    face: "display",
    w: 0.6,
    size: 0.075,
    align: "left",
    color: "offwhite",
    outline: null,
    caps: true,
    balance: false,
    ...partial,
  };
}

export function newShape(shape: ShapeKind, partial: Partial<ShapeLayer> = {}): ShapeLayer {
  const label = SHAPES.find((s) => s.key === shape)?.label ?? "Shape";
  return {
    ...(base("shape", label) as Base & { kind: "shape" }),
    kind: "shape",
    shape,
    // A rule is a line, so it gets no height worth speaking of; everything else
    // starts as a comfortable block you can see and grab.
    w: shape === "line" ? 0.5 : 0.3,
    h: shape === "line" ? 0.012 : 0.3,
    fill: shape === "line" ? null : "mustard",
    stroke: shape === "line" ? "mustard" : "charcoal",
    strokeWidth: shape === "line" ? 0.012 : 0.006,
    radius: 0,
    label: shape === "starburst" ? "New" : "",
    ...partial,
  };
}

export function newImage(name: string, src: ImageLayer["src"], partial: Partial<ImageLayer> = {}): ImageLayer {
  return {
    ...(base("image", name) as Base & { kind: "image" }),
    kind: "image",
    name,
    src,
    w: 0.24,
    flipX: false,
    flipY: false,
    ...partial,
  };
}

/* ------------------------------------------------------------- list edits */

/* Every one of these returns a NEW array. The history stack compares by
 * identity, so an in-place splice would be an edit it could not see. */

export function addLayer(layers: Layer[], layer: Layer): Layer[] {
  return [...layers, layer];
}

export function removeLayer(layers: Layer[], id: string): Layer[] {
  return layers.filter((l) => l.id !== id);
}

export function updateLayer(layers: Layer[], id: string, patch: Partial<Layer>): Layer[] {
  return layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l));
}

export function findLayer(layers: Layer[], id: string | null): Layer | null {
  if (!id) return null;
  return layers.find((l) => l.id === id) ?? null;
}

/** A copy, offset a little so it is visibly a second thing rather than a
 *  perfect overlap you cannot tell you made. */
export function duplicateLayer(layers: Layer[], id: string): { layers: Layer[]; id: string | null } {
  const i = layers.findIndex((l) => l.id === id);
  if (i === -1) return { layers, id: null };
  const copy = {
    ...layers[i],
    id: layerId(),
    x: layers[i].x + 0.03,
    y: layers[i].y + 0.03,
  } as Layer;
  // Directly above the original, not on top of the pile: a duplicate is a
  // sibling of the thing it came from.
  return { layers: [...layers.slice(0, i + 1), copy, ...layers.slice(i + 1)], id: copy.id };
}

/** Move a layer through the stack. `delta` is in steps; Infinity goes all the way. */
export function reorderLayer(layers: Layer[], id: string, delta: number): Layer[] {
  const i = layers.findIndex((l) => l.id === id);
  if (i === -1) return layers;
  const to = Math.max(0, Math.min(layers.length - 1, delta === Infinity ? layers.length - 1 : delta === -Infinity ? 0 : i + delta));
  if (to === i) return layers;
  const next = [...layers];
  const [moved] = next.splice(i, 1);
  next.splice(to, 0, moved);
  return next;
}

/* ----------------------------------------------------------------- colour */

/** A palette key to a hex, or null for "no fill". Anything unknown falls back
 *  rather than throwing: a stored design outlives the palette that wrote it. */
export function colorOf(key: PaletteKey | null, fallback: string | null = null): string | null {
  if (!key) return fallback;
  return PALETTE[key] ?? fallback;
}

/* Which palette entries a layer may be coloured with. All of them: the
 * restriction that matters is the GROUND, which only the colourway sets, and
 * mustard-on-teal or neon-on-charcoal is exactly what the bible asks for in an
 * accent. Naming the list here rather than inlining it means the swatch row and
 * the hydrator cannot drift apart. */
export const LAYER_COLORS: PaletteKey[] = [
  "offwhite",
  "charcoal",
  "mustard",
  "harborTeal",
  "rusty",
  "foggyMint",
  "red",
  "neonGreen",
  "ctaRed",
];
