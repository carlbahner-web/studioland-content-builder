/* Saving a design.
 *
 * Two things, one shape. A DRAFT is written continuously and restored on load,
 * so a reload never costs anything - which matters more now that a design can
 * carry deliberate per-format overrides that would be tedious to redo. A SAVED
 * DESIGN is the same record under a name, so you can come back to last quarter's
 * hiring ad and change the role.
 *
 * Artwork is stored by FILE NAME, never by content. That matches the library's
 * own rule - a handle, not a copy - and means a design picks up the current
 * version of an arrow rather than a snapshot of it. The cost is that a restored
 * design needs the folder reconnected before its stickers can draw, which the
 * UI says plainly rather than silently dropping them.
 */
import { COLORWAYS, FORMATS, type Colorway, type Format } from "./brand.ts";
import { kvDelete, kvGet, kvKeys, kvSet } from "./kv.ts";
import type { InkMode } from "./boil.ts";
import type { Design as DesignContent } from "./sheet.ts";
import type { StarterCopy } from "./starters/socialAd.ts";
import { DEFAULT_CUTOUT } from "./cutout.ts";
import { GRAIN_ALPHA } from "./render.ts";
import {
  LAYER_COLORS,
  newImage,
  newShape,
  newText,
  SHAPES,
  type Face,
  type GrainMode,
  type Layer,
  type ShapeKind,
} from "./layers.ts";

const DRAFT_KEY = "draft";
const DESIGN_PREFIX = "design:";
const PRESET_PREFIX = "preset:";

export type Design = {
  version: 1;
  name: string;
  updated: number;
  shared: DesignContent;
  overrides: Record<string, Partial<DesignContent>>;
  colorway: string;
  format: string;
  ink: InkMode;
  curtain: boolean;
  transparent: boolean;
  grain: number;
};

export type SavedDesign = Design & { id: string };

/* ------------------------------------------------------------- hydration */

/* Everything below is defensive on purpose.
 *
 * A stored design outlives the code that wrote it. Rename a colorway, drop a
 * format, add a required field, and yesterday's draft now references something
 * that no longer exists - and this runs at startup, so a throw here is a tool
 * that will not open, with no obvious way back for whoever hits it. Every field
 * is therefore checked and falls back rather than trusted, and anything
 * unreadable is treated as "no draft" instead of as an error.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const inkOrNull = (v: unknown): InkMode | null =>
  v === "off" || v === "still" || v === "live" ? v : null;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/* One layer, checked field by field.
 *
 * The kind decides which shape the rest has to be, and an unrecognised kind is
 * dropped rather than guessed at: a half-understood layer that draws as
 * something else is worse than one that is gone, because you cannot tell it
 * happened. Everything else falls back, and positions and sizes are CLAMPED
 * rather than rejected - a layer dragged off the artboard by an older build
 * should come back grabbable, not vanish. */
function hydrateLayer(raw: unknown): Layer | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, "");
  if (!id) return null;
  const common = {
    id,
    name: str(raw.name, "Layer"),
    x: clamp(num(raw.x, 0.5), -0.5, 1.5),
    y: clamp(num(raw.y, 0.5), -0.5, 1.5),
    rotation: clamp(num(raw.rotation, 0), -360, 360),
    opacity: clamp(num(raw.opacity, 1), 0, 1),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    ink: inkOrNull(raw.ink),
    grain: oneOf<GrainMode>(raw.grain, ["default", "none", "extra"], "default"),
  };

  if (raw.kind === "text") {
    return newText({
      ...common,
      text: str(raw.text, ""),
      face: oneOf<Face>(raw.face, ["display", "narrow", "body"], "display"),
      w: clamp(num(raw.w, 0.6), 0.02, 4),
      size: clamp(num(raw.size, 0.075), 0.005, 1),
      align: oneOf(raw.align, ["left", "center", "right"] as const, "left"),
      color: oneOf(raw.color, LAYER_COLORS, "offwhite"),
      outline: LAYER_COLORS.includes(raw.outline as never) ? (raw.outline as never) : null,
      caps: raw.caps !== false,
      balance: raw.balance === true,
    });
  }

  if (raw.kind === "shape") {
    return newShape(
      oneOf<ShapeKind>(raw.shape, SHAPES.map((s) => s.key), "rect"),
      {
        ...common,
        w: clamp(num(raw.w, 0.3), 0.005, 4),
        h: clamp(num(raw.h, 0.3), 0.001, 4),
        fill: LAYER_COLORS.includes(raw.fill as never) ? (raw.fill as never) : null,
        stroke: LAYER_COLORS.includes(raw.stroke as never) ? (raw.stroke as never) : null,
        strokeWidth: clamp(num(raw.strokeWidth, 0.006), 0, 0.2),
        radius: clamp(num(raw.radius, 0), 0, 0.5),
        label: str(raw.label, ""),
      },
    );
  }

  if (raw.kind === "image") {
    /* `file` fell out of `name` when the two were one field, and every layer
       written then was a folder image where they were the same string - so
       falling back to `name` reads those correctly. */
    const file = str(raw.file, str(raw.name, ""));
    if (!file) return null;
    const src = raw.src === "upload" || raw.src === "brand" ? raw.src : "library";
    return newImage(file, src, {
      ...common,
      file,
      name: str(raw.name, file),
      w: clamp(num(raw.w, 0.24), 0.005, 4),
      // null is a real value here - "no frame, keep the artwork's own aspect" -
      // so it survives rather than falling back to a number.
      frameH:
        typeof raw.frameH === "number" && Number.isFinite(raw.frameH)
          ? clamp(raw.frameH, 0.005, 4)
          : null,
      zoom: clamp(num(raw.zoom, 1), 1, 8),
      focusX: clamp(num(raw.focusX, 0.5), 0, 1),
      focusY: clamp(num(raw.focusY, 0.5), 0, 1),
      // null is a real value - "leave the artwork as it came".
      cutout: isObj(raw.cutout)
        ? {
            tolerance: clamp(num(raw.cutout.tolerance, DEFAULT_CUTOUT.tolerance), 0, 1),
            feather: clamp(num(raw.cutout.feather, DEFAULT_CUTOUT.feather), 0, 6),
          }
        : null,
      flipX: raw.flipX === true,
      flipY: raw.flipY === true,
    });
  }

  return null;
}

/* Designs written before layers existed carried `stickers`, which were image
 * layers in all but name: same relative placement, same short-edge sizing. So
 * they are converted rather than dropped - `scale` was what is now `w`, and
 * nothing else has to change. A design saved last quarter still opens. */
function migrateStickers(raw: unknown): Layer[] {
  if (!Array.isArray(raw)) return [];
  const out: Layer[] = [];
  for (const s of raw) {
    if (!isObj(s)) continue;
    const name = str(s.name, "");
    const id = str(s.id, "");
    if (!name || !id) continue;
    out.push(
      newImage(name, "library", {
        id,
        file: name,
        name,
        x: clamp(num(s.x, 0.5), -0.5, 1.5),
        y: clamp(num(s.y, 0.5), -0.5, 1.5),
        w: clamp(num(s.scale, 0.24), 0.005, 4),
        rotation: clamp(num(s.rotation, 0), -360, 360),
      }),
    );
  }
  return out;
}

function hydrateLayers(raw: unknown, legacyStickers: unknown, fallback: Layer[]): Layer[] {
  if (Array.isArray(raw)) {
    return raw.map(hydrateLayer).filter((l): l is Layer => l !== null);
  }
  if (Array.isArray(legacyStickers)) return migrateStickers(legacyStickers);
  return fallback;
}

export function hydrateContent(raw: unknown, base: DesignContent): DesignContent {
  if (!isObj(raw)) return base;
  return { layers: hydrateLayers(raw.layers, raw.stickers, base.layers) };
}

/* --------------------------------------------------- the roles that were

   A design written before the roles were deleted carries five named fields and
   a `transforms` map keyed by role. Those cannot be turned into layers in here:
   composing the arrangement needs the artboard's shape, the colourway, the
   decoded artwork and a context to measure text with, none of which a pure
   hydrator has. So the legacy copy is CARRIED OUT instead, and the caller - which
   has all four - composes it and applies the stored transforms on top.

   The alternative was to drop the five and open an old design as an empty
   ground. That is not a migration, it is data loss with a changelog. */
export type LegacyRoles = {
  copy: StarterCopy;
  transforms: Record<string, { x?: number; y?: number; scale?: number; rotation?: number }>;
  ink: Record<string, InkMode>;
};

const BUZZ_KEYS: Record<string, string | null> = {
  wave: "brand:buzz-wave",
  ride: "brand:buzz-ride",
  none: null,
};

function readLegacy(raw: unknown): LegacyRoles | null {
  if (!isObj(raw)) return null;
  // Layers already present means it was written after the change.
  if (Array.isArray(raw.layers) && raw.layers.length) return null;
  if (typeof raw.headline !== "string" && typeof raw.body !== "string") return null;
  const buzz = str(raw.buzz, "wave");
  return {
    copy: {
      headline: str(raw.headline, ""),
      body: str(raw.body, ""),
      cta: str(raw.cta, ""),
      buzz: buzz in BUZZ_KEYS ? BUZZ_KEYS[buzz] : "brand:buzz-wave",
    },
    transforms: hydrateTransforms(raw.transforms, raw.nudges, raw.scales) as LegacyRoles["transforms"],
    ink: hydrateInk(raw.inkOverrides) as Record<string, InkMode>,
  };
}

/* Transforms, clamped so a stored value can never put something unreachable or
 * invisible. Also migrates the older `nudges` + `scales` pair, which stored a
 * position as an OFFSET from the layout - those cannot be converted to absolute
 * positions without re-running the layout, so the offset is dropped and the
 * scale kept. An element returns to its automatic position; nothing breaks. */
function hydrateTransforms(
  raw: unknown,
  legacyNudges: unknown,
  legacyScales: unknown,
): LegacyRoles["transforms"] {
  const out: LegacyRoles["transforms"] = {};
  if (isObj(raw)) {
    for (const [id, v] of Object.entries(raw)) {
      if (!isObj(v)) continue;
      const tr: LegacyRoles["transforms"][string] = {};
      if (typeof v.x === "number" && Number.isFinite(v.x)) tr.x = clamp(v.x, -0.5, 1.5);
      if (typeof v.y === "number" && Number.isFinite(v.y)) tr.y = clamp(v.y, -0.5, 1.5);
      if (typeof v.scale === "number" && Number.isFinite(v.scale)) tr.scale = clamp(v.scale, 0.05, 4);
      if (typeof v.rotation === "number" && Number.isFinite(v.rotation)) {
        tr.rotation = clamp(v.rotation, -360, 360);
      }
      if (Object.keys(tr).length) out[id] = tr;
    }
  }
  if (isObj(legacyScales)) {
    for (const [id, v] of Object.entries(legacyScales)) {
      if (out[id]?.scale === undefined && typeof v === "number" && Number.isFinite(v)) {
        out[id] = { ...out[id], scale: clamp(v, 0.05, 4) };
      }
    }
  }
  void legacyNudges;
  return out;
}

function hydrateInk(raw: unknown): Record<string, InkMode> {
  const out: Record<string, InkMode> = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (v === "off" || v === "still" || v === "live") out[id] = v;
  }
  return out;
}

function hydratePartial(raw: unknown): Partial<DesignContent> {
  if (!isObj(raw)) return {};
  const out: Partial<DesignContent> = {};
  if (Array.isArray(raw.layers) || Array.isArray(raw.stickers)) {
    out.layers = hydrateLayers(raw.layers, raw.stickers, []);
  }
  return out;
}

export type Restored = {
  shared: DesignContent;
  overrides: Record<string, Partial<DesignContent>>;
  /** Set when the design predates layers and still has to be composed. */
  legacy: LegacyRoles | null;
  colorway: Colorway;
  format: Format;
  ink: InkMode;
  curtain: boolean;
  transparent: boolean;
  grain: number;
  name: string;
};

/* `formats` is passed in rather than read off the constant, because the list is
 * no longer fixed: a custom size added at runtime is a real format, and a design
 * that carries per-format work for one must not have it dropped just because
 * this function could not see it. The caller loads the custom sizes BEFORE
 * hydrating anything - see formats.ts. */
export function hydrate(
  raw: unknown,
  base: DesignContent,
  formats: Format[] = FORMATS,
): Restored | null {
  if (!isObj(raw)) return null;
  const known = formats.length ? formats : FORMATS;
  const overrides: Record<string, Partial<DesignContent>> = {};
  if (isObj(raw.overrides)) {
    for (const [key, patch] of Object.entries(raw.overrides)) {
      // An override for a format that no longer exists is dropped, not kept as
      // a ghost that can never be seen or reset.
      if (!known.some((f) => f.key === key)) continue;
      const clean = hydratePartial(patch);
      if (Object.keys(clean).length) overrides[key] = clean;
    }
  }
  const ink = str(raw.ink, "still");
  return {
    shared: hydrateContent(raw.shared, base),
    legacy: readLegacy(raw.shared),
    overrides,
    colorway: COLORWAYS.find((c) => c.key === raw.colorway) ?? COLORWAYS[0],
    format: known.find((f) => f.key === raw.format) ?? known[0],
    ink: (["off", "still", "live"].includes(ink) ? ink : "still") as InkMode,
    curtain: typeof raw.curtain === "boolean" ? raw.curtain : true,
    transparent: raw.transparent === true,
    grain: clamp(num(raw.grain, GRAIN_ALPHA), 0, 1),
    name: str(raw.name, ""),
  };
}

/* Every piece of artwork a design refers to, across shared and every override.
 *
 * WHICH LIBRARY it came from is carried through rather than inferred from the
 * name, because the two fail differently and the panel has to say which: a
 * folder image is missing until the folder is reconnected, and an upload is
 * missing because it is not in this browser - a design opened on the phone that
 * was made at the desk. Guessing from the name would collapse those into one
 * unhelpful "could not be found". */
export type ArtworkRef = { name: string; src: "library" | "upload" | "brand" };

export function artworkNames(
  shared: DesignContent,
  overrides: Record<string, Partial<DesignContent>>,
): ArtworkRef[] {
  const seen = new Map<string, ArtworkRef>();
  const collect = (layers: Layer[] | undefined) => {
    for (const l of layers ?? []) {
      // Brand artwork always resolves, so it is never "missing" and never listed.
      if (l.kind === "image" && l.src !== "brand" && !seen.has(l.file)) {
        seen.set(l.file, { name: l.file, src: l.src });
      }
    }
  };
  collect(shared.layers);
  for (const patch of Object.values(overrides)) collect(patch.layers);
  return [...seen.values()];
}

/* ---------------------------------------------------------------- storage */

/* Writes are best-effort, like the library's. Losing a draft is a nuisance;
 * an unhandled rejection while someone is typing is worse. */
export async function saveDraft(design: Omit<Design, "version" | "name">): Promise<void> {
  try {
    await kvSet(DRAFT_KEY, { ...design, version: 1, name: "" });
  } catch {
    /* not fatal */
  }
}

export async function loadDraft(): Promise<unknown> {
  return kvGet(DRAFT_KEY).catch(() => undefined);
}

export async function saveDesign(name: string, design: Omit<Design, "version" | "name">) {
  const id = `${DESIGN_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await kvSet(id, { ...design, version: 1, name });
  return id;
}

export async function listDesigns(): Promise<SavedDesign[]> {
  const keys = await kvKeys(DESIGN_PREFIX).catch(() => []);
  const out: SavedDesign[] = [];
  for (const id of keys) {
    const d = await kvGet<Design>(id).catch(() => undefined);
    if (d) out.push({ ...d, id });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export async function loadDesign(id: string): Promise<unknown> {
  return kvGet(id).catch(() => undefined);
}

export async function deleteDesign(id: string): Promise<void> {
  await kvDelete(id).catch(() => {});
  // A deleted design cannot go on being the starting point.
  if ((await startDesign()) === id) await setStartDesign(null);
}

/* ------------------------------------------------------- the starting point

   Which saved design opens on a blank start.

   This is a POINTER, not a copy, and that is the whole of its design: it names
   one of your saved designs, so changing what the tool opens with means opening
   that design, editing it and saving - not editing source and shipping a build.
   The alternative was baking a default arrangement into the code, which would
   have made "the starting point" something only a developer could change, for a
   decision that is entirely a matter of taste and will change often. */
const START_KEY = "start-design";

export async function startDesign(): Promise<string | null> {
  const id = await kvGet<string>(START_KEY).catch(() => undefined);
  return typeof id === "string" ? id : null;
}

export async function setStartDesign(id: string | null): Promise<void> {
  try {
    if (id) await kvSet(START_KEY, id);
    else await kvDelete(START_KEY);
  } catch {
    /* best-effort, like every other write here */
  }
}


/* ---------------------------------------------------------------- presets */

/* A preset is an ARRANGEMENT AND A LOOK, without the words.
 *
 * That split is the whole point of it being a separate thing from a saved
 * design. A saved design is one finished ad, words and all - you reopen it to
 * change the role in a hiring post. A preset is the layout you liked, applied
 * to whatever copy you have in front of you now, which is what makes free
 * placement workable: the layout used to guarantee a sensible arrangement, and
 * now presets are how you get one back without hand-placing every element.
 *
 * So it carries transforms, ink, stickers, the BUZZ pose, the colourway - and
 * deliberately not the headline, supporting line or call to action.
 */
export type Preset = {
  version: 1;
  name: string;
  updated: number;
  layers: Layer[];
  colorway: string;
  ink: InkMode;
  curtain: boolean;
};

export type SavedPreset = Preset & { id: string };

export function hydratePreset(raw: unknown): Omit<Preset, "version" | "name" | "updated"> | null {
  if (!isObj(raw)) return null;
  const partial = hydrateContent(raw, { layers: [] });
  const ink = str(raw.ink, "still");
  return {
    layers: partial.layers,
    colorway: COLORWAYS.find((c) => c.key === raw.colorway)?.key ?? COLORWAYS[0].key,
    ink: (["off", "still", "live"].includes(ink) ? ink : "still") as InkMode,
    curtain: typeof raw.curtain === "boolean" ? raw.curtain : true,
  };
}

export async function savePreset(name: string, preset: Omit<Preset, "version" | "name">) {
  const id = `${PRESET_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await kvSet(id, { ...preset, version: 1, name });
  return id;
}

export async function listPresets(): Promise<SavedPreset[]> {
  const keys = await kvKeys(PRESET_PREFIX).catch(() => []);
  const out: SavedPreset[] = [];
  for (const id of keys) {
    const d = await kvGet<Preset>(id).catch(() => undefined);
    if (d) out.push({ ...d, id });
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export async function loadPreset(id: string): Promise<unknown> {
  return kvGet(id).catch(() => undefined);
}

export async function deletePreset(id: string): Promise<void> {
  await kvDelete(id).catch(() => {});
}
