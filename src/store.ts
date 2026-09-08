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
import type { SocialAdContent, Sticker } from "./templates/socialAd.ts";

const DRAFT_KEY = "draft";
const DESIGN_PREFIX = "design:";
const PRESET_PREFIX = "preset:";

export type Design = {
  version: 1;
  name: string;
  updated: number;
  shared: SocialAdContent;
  overrides: Record<string, Partial<SocialAdContent>>;
  colorway: string;
  format: string;
  ink: InkMode;
  curtain: boolean;
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

function hydrateSticker(raw: unknown): Sticker | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, "");
  const id = str(raw.id, "");
  if (!name || !id) return null;
  return {
    id,
    name,
    // Clamped rather than rejected: a sticker dragged off-canvas in an older
    // build should come back reachable, not vanish.
    x: Math.min(1.5, Math.max(-0.5, num(raw.x, 0.5))),
    y: Math.min(1.5, Math.max(-0.5, num(raw.y, 0.5))),
    scale: Math.min(2, Math.max(0.01, num(raw.scale, 0.24))),
    rotation: num(raw.rotation, 0),
  };
}

export function hydrateContent(raw: unknown, base: SocialAdContent): SocialAdContent {
  if (!isObj(raw)) return base;
  const buzz = str(raw.buzz, base.buzz);
  return {
    headline: str(raw.headline, base.headline),
    body: str(raw.body, base.body),
    cta: str(raw.cta, base.cta),
    buzz: buzz as SocialAdContent["buzz"],
    stickers: Array.isArray(raw.stickers)
      ? raw.stickers.map(hydrateSticker).filter((s): s is Sticker => s !== null)
      : base.stickers,
    transforms: hydrateTransforms(raw.transforms, raw.nudges, raw.scales),
    inkOverrides: hydrateInk(raw.inkOverrides),
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
): SocialAdContent["transforms"] {
  const out: SocialAdContent["transforms"] = {};
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (isObj(raw)) {
    for (const [id, v] of Object.entries(raw)) {
      if (!isObj(v)) continue;
      const tr: NonNullable<SocialAdContent["transforms"][string]> = {};
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

function hydrateInk(raw: unknown): SocialAdContent["inkOverrides"] {
  const out: SocialAdContent["inkOverrides"] = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (v === "off" || v === "still" || v === "live") out[id] = v;
  }
  return out;
}

function hydratePartial(raw: unknown): Partial<SocialAdContent> {
  if (!isObj(raw)) return {};
  const out: Partial<SocialAdContent> = {};
  if (typeof raw.headline === "string") out.headline = raw.headline;
  if (typeof raw.body === "string") out.body = raw.body;
  if (typeof raw.cta === "string") out.cta = raw.cta;
  if (typeof raw.buzz === "string") out.buzz = raw.buzz as SocialAdContent["buzz"];
  if (isObj(raw.transforms) || isObj(raw.scales)) {
    out.transforms = hydrateTransforms(raw.transforms, raw.nudges, raw.scales);
  }
  if (isObj(raw.inkOverrides)) out.inkOverrides = hydrateInk(raw.inkOverrides);
  if (Array.isArray(raw.stickers)) {
    out.stickers = raw.stickers.map(hydrateSticker).filter((s): s is Sticker => s !== null);
  }
  return out;
}

export type Restored = {
  shared: SocialAdContent;
  overrides: Record<string, Partial<SocialAdContent>>;
  colorway: Colorway;
  format: Format;
  ink: InkMode;
  curtain: boolean;
  name: string;
};

export function hydrate(raw: unknown, base: SocialAdContent): Restored | null {
  if (!isObj(raw)) return null;
  const overrides: Record<string, Partial<SocialAdContent>> = {};
  if (isObj(raw.overrides)) {
    for (const [key, patch] of Object.entries(raw.overrides)) {
      // An override for a format that no longer exists is dropped, not kept as
      // a ghost that can never be seen or reset.
      if (!FORMATS.some((f) => f.key === key)) continue;
      const clean = hydratePartial(patch);
      if (Object.keys(clean).length) overrides[key] = clean;
    }
  }
  const ink = str(raw.ink, "still");
  return {
    shared: hydrateContent(raw.shared, base),
    overrides,
    colorway: COLORWAYS.find((c) => c.key === raw.colorway) ?? COLORWAYS[0],
    format: FORMATS.find((f) => f.key === raw.format) ?? FORMATS[0],
    ink: (["off", "still", "live"].includes(ink) ? ink : "still") as InkMode,
    curtain: typeof raw.curtain === "boolean" ? raw.curtain : true,
    name: str(raw.name, ""),
  };
}

/** Every artwork file name a design refers to, across shared and overrides. */
export function artworkNames(
  shared: SocialAdContent,
  overrides: Record<string, Partial<SocialAdContent>>,
): string[] {
  const names = new Set<string>();
  for (const s of shared.stickers) names.add(s.name);
  for (const patch of Object.values(overrides)) {
    for (const s of patch.stickers ?? []) names.add(s.name);
  }
  return [...names];
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
  transforms: SocialAdContent["transforms"];
  inkOverrides: SocialAdContent["inkOverrides"];
  stickers: Sticker[];
  buzz: SocialAdContent["buzz"];
  colorway: string;
  ink: InkMode;
  curtain: boolean;
};

export type SavedPreset = Preset & { id: string };

export function hydratePreset(raw: unknown): Omit<Preset, "version" | "name" | "updated"> | null {
  if (!isObj(raw)) return null;
  const partial = hydrateContent(raw, {
    headline: "",
    body: "",
    cta: "",
    buzz: "wave",
    stickers: [],
    transforms: {},
    inkOverrides: {},
  });
  const ink = str(raw.ink, "still");
  return {
    transforms: partial.transforms,
    inkOverrides: partial.inkOverrides,
    stickers: partial.stickers,
    buzz: partial.buzz,
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
