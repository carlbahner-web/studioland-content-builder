import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUZZ_POSES,
  COLORWAYS,
  PALETTE,
  FORMATS,
  type BuzzPose,
  type Colorway,
  type Format,
  type PaletteKey,
} from "./brand.ts";
import { loadBrandFonts, loadImage, prepareGrain } from "./render.ts";
import { FPS, type InkMode } from "./boil.ts";
import { assetUrl } from "./assets.ts";
import { Artboard, type Manipulator } from "./Artboard.tsx";
import {
  canRedo,
  canUndo,
  initHistory,
  pushHistory,
  redo,
  resetHistory,
  undo,
  type History,
} from "./history.ts";
import {
  addLayer,
  duplicateLayer,
  findLayer,
  LAYER_COLORS,
  newImage,
  newShape,
  newText,
  reorderLayer,
  updateLayer,
  FACES,
  SHAPES,
  type Face,
  type Layer,
  type ShapeKind,
} from "./layers.ts";
import {
  LOOP_FRAMES,
  minMarkScale,
  type Assets,
  type Region,
  type SocialAdContent,
} from "./templates/socialAd.ts";
import {
  artworkNames,
  deleteDesign,
  hydrate,
  listDesigns,
  loadDesign,
  loadDraft,
  deletePreset,
  hydratePreset,
  listPresets,
  loadPreset,
  saveDesign,
  saveDraft,
  savePreset,
  type SavedPreset,
  type SavedDesign,
} from "./store.ts";
import {
  chooseFolder,
  folderName,
  listLibrary,
  loadFromLibrary,
  reconnectFolder,
  savedFolder,
  SUPPORTED as LIBRARY_SUPPORTED,
  thumbnail,
  type LibraryItem,
} from "./library.ts";
import {
  addUpload,
  deleteUpload,
  listUploads,
  loadUpload,
  uploadThumb,
  type UploadItem,
} from "./uploads.ts";
import {
  customKey,
  formatProblem,
  isCustom,
  loadFormats,
  saveFormats,
} from "./formats.ts";
import "./studio.css";

const DEFAULT_CONTENT: SocialAdContent = {
  headline: "Your mixes deserve a better client list",
  body: "StudioLand trains audio engineers to find and book the artists they actually want to work with.",
  cta: "Learn more",
  buzz: "wave",
  layers: [],
  transforms: {},
  inkOverrides: {},
};

/* THE DOCUMENT: everything an undo step has to restore.
 *
 * The format is deliberately NOT in here. It is which view of the design you are
 * looking at, not something about the design, and putting it in would mean
 * cmd-Z sometimes switched format instead of taking back the edit you just made
 * - which is the behaviour that makes people stop trusting undo. It is still
 * saved with the draft, so reopening the tool puts you back where you were. */
type Doc = {
  shared: SocialAdContent;
  overrides: Record<string, Partial<SocialAdContent>>;
  colorway: string;
  ink: InkMode;
  curtain: boolean;
};

const INITIAL: Doc = {
  shared: DEFAULT_CONTENT,
  overrides: {},
  colorway: COLORWAYS[0].key,
  ink: "still",
  curtain: true,
};

const contentOf = (d: Doc, formatKey: string): SocialAdContent => ({
  ...d.shared,
  ...(d.overrides[formatKey] ?? {}),
});

/* A labelled control that says, right on the label, when this format's value has
 * been forked from the shared one - and offers the way back. The scope toggle is
 * modal, so the state it produces has to be visible without anyone going
 * looking for it. */
function Field({
  label,
  name,
  overridden,
  onClear,
  children,
}: {
  label: string;
  name: keyof SocialAdContent;
  overridden: Set<string>;
  onClear: (k: keyof SocialAdContent) => void;
  children: React.ReactNode;
}) {
  const forked = overridden.has(name);
  return (
    <label className={forked ? "fld forked" : "fld"}>
      <span className="lbl">
        {label}
        {forked && (
          <button
            type="button"
            className="undo"
            title="This format only. Click to go back to the shared value."
            onClick={(e) => {
              e.preventDefault();
              onClear(name);
            }}
          >
            this format only &times;
          </button>
        )}
      </span>
      {children}
    </label>
  );
}

/* A foldable section.
 *
 * The panel grew a lot when layers arrived, and a single column of eleven
 * headings is a scroll you have to read every time to find the one control you
 * came for. So the WORKING AREA stays open at the top - add, the selected
 * thing, the layer list - and everything that is a setting rather than an
 * action folds away. Content and Format stay open because they are the two you
 * touch on every single asset. */
function Section({
  title,
  open,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="sect" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

/** A row of palette swatches, optionally with a "none" option. */
function Swatches({
  value,
  onChange,
  none,
}: {
  value: PaletteKey | null;
  onChange: (key: PaletteKey | null) => void;
  none?: boolean;
}) {
  return (
    <div className="palette">
      {none && (
        <button
          type="button"
          title="None"
          className={value === null ? "pk none on" : "pk none"}
          onClick={() => onChange(null)}
        />
      )}
      {LAYER_COLORS.map((key) => (
        <button
          key={key}
          type="button"
          title={key}
          aria-label={key}
          className={value === key ? "pk on" : "pk"}
          style={{ background: PALETTE[key] }}
          onClick={() => onChange(key)}
        />
      ))}
    </div>
  );
}

/* A programmatic download is not reliable everywhere.
 *
 * iOS Safari treats `<a download>` on a blob inconsistently - often opening the
 * image in a new tab instead of saving it - and a sandboxed iframe (a preview
 * embedded elsewhere) blocks it outright. On both, the gesture people actually
 * use is press-and-hold on the image itself. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/* One element aligns to the artboard; several align to each other. Same six
 * buttons either way - see alignTo. */
const ALIGNS = [
  ["left", "⇤", "Align left"],
  ["cx", "↔", "Centre across"],
  ["right", "⇥", "Align right"],
  ["top", "⇡", "Align top"],
  ["cy", "↕", "Centre down"],
  ["bottom", "⇣", "Align bottom"],
] as const;

const LABELS: Record<string, string> = {
  headline: "Headline",
  body: "Supporting line",
  cta: "Call to action",
  buzz: "BUZZ",
  wordmark: "Wordmark",
};

export default function App() {
  /* Content is a SHARED base plus per-format overrides, resolved at render, and
   * the whole of it goes through the history stack. The scope toggle is
   * deliberately modal, which is the one thing worth being careful about: a
   * change made in the wrong scope forks something quietly and you find out
   * later. So every bit of divergence is surfaced - a dot on any format carrying
   * overrides, a badge on any field overridden here, and resets at both levels. */
  const [hist, setHist] = useState<History<Doc>>(() => initHistory(INITIAL));
  const doc = hist.present;

  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const [scope, setScope] = useState<"all" | "format">("all");
  /* The built-in sizes plus any you added. Kept in state rather than read off
     the constant because the list is no longer fixed - see formats.ts. */
  const [custom, setCustom] = useState<Format[]>([]);
  const formats = useMemo(() => [...FORMATS, ...custom], [custom]);
  const [newSize, setNewSize] = useState({ label: "", w: "1080", h: "1080" });
  const [sizeError, setSizeError] = useState<string | null>(null);

  const colorway: Colorway = COLORWAYS.find((c) => c.key === doc.colorway) ?? COLORWAYS[0];
  const content = useMemo(() => contentOf(doc, format.key), [doc, format.key]);
  const overridden = new Set(Object.keys(doc.overrides[format.key] ?? {}));

  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lib, setLib] = useState<LibraryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  /* SELECTION is a list. Most of the panel is written for a lone selection -
     an inspector for six different things at once is a worse control than a
     handful of group actions - so `selected` is the one-element case and the
     multi case gets its own short section. */
  const [selection, setSelection] = useState<string[]>([]);
  const selected = selection.length === 1 ? selection[0] : null;
  const setSelected = useCallback(
    (id: string | null) => setSelection(id ? [id] : []),
    [],
  );
  const [regions, setRegions] = useState<Region[]>([]);
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [designName, setDesignName] = useState("");
  const [restored, setRestored] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  /* Previews hold still by default now that "still" is the default ink: the
     boil is a property of the asset, and watching it flicker is a thing you turn
     on to check the video, not the state you work in. */
  const [animate, setAnimate] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------- the doc */

  const commit = useCallback((fn: (d: Doc) => Doc, tag: string | null = null) => {
    setHist((h) => pushHistory(h, fn(h.present), tag, Date.now()));
  }, []);

  /* Writing in "all formats" scope also CLEARS that field's overrides
   * everywhere. Leaving them would mean "all formats" quietly did not mean all
   * formats - which is the exact silent divergence the markers exist to prevent,
   * so it cannot be built into the write path. Re-overriding is one switch away;
   * a change that appeared to apply and did not is not recoverable, because you
   * never see it. */
  const edit = useCallback(
    <K extends keyof SocialAdContent>(
      k: K,
      v: SocialAdContent[K] | ((cur: SocialAdContent[K]) => SocialAdContent[K]),
      tag: string | null = null,
    ) => {
      commit((d) => {
        const cur = contentOf(d, format.key)[k];
        const next = typeof v === "function" ? (v as (c: SocialAdContent[K]) => SocialAdContent[K])(cur) : v;
        if (scope === "all") {
          const overrides: Record<string, Partial<SocialAdContent>> = {};
          for (const [key, patch] of Object.entries(d.overrides)) {
            const { [k]: _drop, ...rest } = patch;
            if (Object.keys(rest).length) overrides[key] = rest;
          }
          return { ...d, shared: { ...d.shared, [k]: next }, overrides };
        }
        return {
          ...d,
          overrides: {
            ...d.overrides,
            [format.key]: { ...(d.overrides[format.key] ?? {}), [k]: next },
          },
        };
      }, tag);
    },
    [commit, format.key, scope],
  );

  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  /* ----------------------------------------------------------- the layers */

  const patchLayer = useCallback(
    (id: string, patch: Partial<Layer>, tag: string | null = null) =>
      edit("layers", (ls) => updateLayer(ls, id, patch), tag),
    [edit],
  );

  const addNew = useCallback(
    (layer: Layer) => {
      edit("layers", (ls) => addLayer(ls, layer));
      setSelected(layer.id);
    },
    [edit],
  );

  /* Both of these take a LIST and land as ONE undo step, because "duplicate
     these four" and "delete these four" are each one thing you did. Looping a
     single-item helper would record four steps and make cmd-Z take four presses
     to put back what one press made. */
  const duplicateMany = useCallback(
    (ids: string[]) => {
      const made: string[] = [];
      edit("layers", (ls) => {
        let next = ls;
        for (const id of ids) {
          const r = duplicateLayer(next, id);
          next = r.layers;
          if (r.id) made.push(r.id);
        }
        return next;
      });
      if (made.length) setSelection(made);
    },
    [edit],
  );

  const dropMany = useCallback(
    (ids: string[]) => {
      edit("layers", (ls) => ls.filter((l) => !ids.includes(l.id)));
      setSelection((s) => s.filter((id) => !ids.includes(id)));
    },
    [edit],
  );

  const dropLayer = useCallback((id: string) => dropMany([id]), [dropMany]);

  const restack = useCallback(
    (id: string, delta: number) => edit("layers", (ls) => reorderLayer(ls, id, delta)),
    [edit],
  );

  /* ------------------------------------------------------- the transforms */

  const setTransform = useCallback(
    (
      id: string,
      patch: Partial<{ x: number; y: number; scale: number; rotation: number }>,
      tag: string | null = null,
    ) => edit("transforms", (t) => ({ ...t, [id]: { ...t[id], ...patch } }), tag),
    [edit],
  );

  const clearTransform = useCallback(
    (id: string) =>
      edit("transforms", (t) => {
        const next = { ...t };
        delete next[id];
        return next;
      }),
    [edit],
  );

  /* Put everything back to what the layout would do for this format. The layout
     is the default arrangement now rather than the only one, so this is how you
     get it back after moving things around. Layers are untouched: they were
     never in the layout, so it has nothing to say about where they go. */
  const autoArrange = useCallback(() => edit("transforms", {}), [edit]);

  const setElementInk = useCallback(
    (id: string, mode: InkMode | null) =>
      edit("inkOverrides", (o) => {
        const next = { ...o };
        if (mode) next[id] = mode;
        else delete next[id];
        return next;
      }),
    [edit],
  );

  /* ---------------------------------------------------- what the artboard
     is allowed to change, without knowing which kind of thing it holds */

  const manip: Manipulator = useMemo(
    () => ({
      pos: (id, fallback) => {
        const l = findLayer(content.layers, id);
        if (l) return { x: l.x, y: l.y };
        const tr = content.transforms[id] ?? {};
        return { x: tr.x ?? fallback.x, y: tr.y ?? fallback.y };
      },
      setPos: (id, x, y) => {
        if (findLayer(content.layers, id)) patchLayer(id, { x, y }, `drag:${id}`);
        else setTransform(id, { x, y }, `drag:${id}`);
      },
      scale: (id) => {
        const l = findLayer(content.layers, id);
        if (!l) return content.transforms[id]?.scale ?? 1;
        return l.kind === "text" ? l.size : l.w;
      },
      setScale: (id, v) => {
        const l = findLayer(content.layers, id);
        const tag = `size:${id}`;
        /* The wordmark has a floor. The bible sets a minimum size "so the
           arrow-I signpost stops reading", and it is enforced HERE rather than
           on the slider because a corner handle is now another way to get
           below it - a limit that only one of two paths respects is not a
           limit. */
        if (id === "wordmark") return setTransform(id, { scale: Math.max(minMarkScale(format), v) }, tag);
        if (!l) return setTransform(id, { scale: v }, tag);
        // A corner is proportional, so the OTHER dimension follows by the same
        // ratio: a text box keeps its measure as the type grows, and a shape
        // keeps its proportions instead of turning into a different shape.
        if (l.kind === "text") {
          const r = v / (l.size || 1);
          patchLayer(id, { size: v, w: l.w * r }, tag);
        } else if (l.kind === "shape") {
          const r = v / (l.w || 1);
          patchLayer(id, { w: v, h: l.h * r }, tag);
        } else {
          patchLayer(id, { w: v }, tag);
        }
      },
      rot: (id) => {
        const l = findLayer(content.layers, id);
        return l ? l.rotation : (content.transforms[id]?.rotation ?? 0);
      },
      setRot: (id, deg) => {
        if (findLayer(content.layers, id)) patchLayer(id, { rotation: deg }, `rot:${id}`);
        else setTransform(id, { rotation: deg }, `rot:${id}`);
      },
      extent: (id) => {
        const l = findLayer(content.layers, id);
        if (!l) return null;
        // A text box has a width you set and a height it works out; a shape has
        // both; an image has the artwork's aspect and stretching it is not
        // something this tool offers.
        if (l.kind === "text") return { w: l.w, h: null };
        if (l.kind === "shape") return { w: l.w, h: l.h };
        return null;
      },
      setExtent: (id, w, h) => {
        const l = findLayer(content.layers, id);
        if (!l) return;
        if (l.kind === "text") patchLayer(id, { w }, `size:${id}`);
        else if (l.kind === "shape") patchLayer(id, { w, h }, `size:${id}`);
      },
      locked: (id) => findLayer(content.layers, id)?.locked === true,
    }),
    [content, format, patchLayer, setTransform],
  );

  /* ------------------------------------------------------------ the boot */

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [, grain, cream, charcoal, wave, ride] = await Promise.all([
          loadBrandFonts(),
          loadImage(assetUrl("/brand/grain.webp")),
          loadImage(assetUrl("/brand/studioland-wordmark-cream.png")),
          loadImage(assetUrl("/brand/studioland-wordmark-charcoal.png")),
          loadImage(assetUrl("/brand/buzz-wave.webp")),
          loadImage(assetUrl("/brand/buzz-ride.webp")),
        ]);
        if (!live) return;
        prepareGrain(grain);
        setAssets({ buzz: { wave, ride }, wordmark: { cream, charcoal }, images: {} });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // On load we only ask whether a folder was saved. Nothing is listed, nothing
  // is opened. The whole library stays untouched until it is asked for.
  useEffect(() => {
    savedFolder().then(setSaved).catch(() => setSaved(null));
    listUploads().then(setUploads).catch(() => {});
  }, []);

  /* Pull decoded images for every piece of artwork a design refers to. Uploads
     resolve immediately - they live in this browser. Folder images cannot until
     the folder is connected, which is the moment a restored design's images can
     finally draw; before that they are names with nothing behind them. */
  const attachArtwork = useCallback(
    async (sh: SocialAdContent, ov: Record<string, Partial<SocialAdContent>>) => {
      const refs = artworkNames(sh, ov);
      if (!refs.length) return;
      const loaded: Record<string, HTMLImageElement> = {};
      for (const ref of refs) {
        try {
          loaded[ref.name] =
            ref.src === "upload" ? await loadUpload(ref.name) : await loadFromLibrary(ref.name);
        } catch {
          // Renamed, deleted, or in another browser. The layer keeps its place
          // in the design and simply does not draw; saying so is the Artwork
          // panel's job, not a reason to drop it.
        }
      }
      if (Object.keys(loaded).length) {
        setAssets((prev) => (prev ? { ...prev, images: { ...prev.images, ...loaded } } : prev));
      }
    },
    [],
  );

  const applyDesign = useCallback(
    (d: ReturnType<typeof hydrate>) => {
      if (!d) return;
      /* RESET rather than push: the states before this belong to a different
         document, and undoing into them would take you out of the design you
         just opened with no way to tell what happened. */
      setHist((h) =>
        resetHistory(h, {
          shared: d.shared,
          overrides: d.overrides,
          colorway: d.colorway.key,
          ink: d.ink,
          curtain: d.curtain,
        }),
      );
      setFormat(d.format);
      setSelected(null);
      setScope("all");
      void attachArtwork(d.shared, d.overrides);
    },
    [attachArtwork],
  );

  /* Restore the draft once, before the first autosave can run. `restored` gates
     the writer below: without it the empty initial state would be written over
     the draft in the same tick the page opened, which is the classic way an
     autosave feature eats the thing it was added to protect. */
  useEffect(() => {
    /* Custom sizes are loaded FIRST and the draft is hydrated against them.
       hydrate() drops overrides for formats it does not recognise, so reading
       the draft before the sizes are known would silently throw away the
       per-format work on every custom size in it. */
    (async () => {
      let known = FORMATS;
      try {
        const mine = await loadFormats();
        setCustom(mine);
        known = [...FORMATS, ...mine];
      } catch {
        /* no custom sizes is a fine state to open in */
      }
      try {
        const d = hydrate(await loadDraft(), DEFAULT_CONTENT, known);
        if (d) applyDesign(d);
      } finally {
        setRestored(true);
      }
    })();
    listDesigns().then(setDesigns).catch(() => {});
    listPresets().then(setPresets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Autosave, debounced. Everything that makes the design what it is, plus the
     format, which is not part of the document but is where you left off. */
  useEffect(() => {
    if (!restored) return;
    const id = window.setTimeout(() => {
      void saveDraft({ ...doc, updated: Date.now(), format: format.key });
    }, 400);
    return () => window.clearTimeout(id);
  }, [restored, doc, format]);

  /* -------------------------------------------------------- the keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const meta = e.metaKey || e.ctrlKey;

      /* While the caret is in a field, the field's own undo is the one you
         want: cmd-Z should take back the word you typed, not the layer you
         added five minutes ago. Everything else stays out of the way too - an
         arrow key is moving the caret, and Delete is deleting a character. */
      if (typing) return;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      /* Select-all sits ABOVE the "nothing selected" guard, because an empty
         selection is exactly the state you press it in. */
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(regions.filter((r) => !manip.locked(r.id)).map((r) => r.id));
        return;
      }

      if (!selection.length) return;
      /* Every shortcut below acts on the WHOLE selection. The layer-only ones
         quietly skip the template's five rather than refusing outright, so
         cmd-D on a mixed selection duplicates what can be duplicated instead of
         doing nothing and leaving you to work out why. */
      const layers = selection
        .map((id) => findLayer(content.layers, id))
        .filter((l): l is NonNullable<typeof l> => l !== null && !l.locked);

      if (e.key === "Escape") {
        setSelection([]);
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (layers.length) duplicateMany(layers.map((l) => l.id));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // Only layers are deletable. The template's five are part of the
        // composition - the way to be rid of one is to empty its text.
        if (layers.length) {
          e.preventDefault();
          dropMany(layers.map((l) => l.id));
        }
        return;
      }
      if (meta && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        const by = e.key === "]" ? 1 : -1;
        for (const l of layers) restack(l.id, e.shiftKey ? by * Infinity : by);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const dir = arrows[e.key];
      if (!dir) return;
      e.preventDefault();
      // One artboard pixel, ten with shift. Nudging in artboard pixels rather
      // than screen ones means the same keypress means the same thing whatever
      // the preview happens to be scaled to.
      const step = e.shiftKey ? 10 : 1;
      for (const id of selection) {
        if (manip.locked(id)) continue;
        const here = regions.find((r) => r.id === id);
        const at = manip.pos(id, {
          x: (here?.cx ?? format.w / 2) / format.w,
          y: (here?.cy ?? format.h / 2) / format.h,
        });
        manip.setPos(id, at.x + (dir[0] * step) / format.w, at.y + (dir[1] * step) / format.h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, content, regions, format, manip, doUndo, doRedo, duplicateMany, dropMany, restack]);

  /* ---------------------------------------------------------- the library */

  const openLibrary = useCallback(
    async (fresh: boolean) => {
      setLibError(null);
      try {
        const name = fresh ? await chooseFolder() : (await reconnectFolder()) ? folderName() : null;
        if (!name) {
          setLibError("Access was not granted.");
          return;
        }
        setFolder(name);
        setSaved(name);
        const items = await listLibrary();
        setLib(items);
        // A design restored before the folder was connected has layers waiting
        // on exactly this moment.
        void attachArtwork(doc.shared, doc.overrides);
        // Thumbnails resolve one at a time, from cache where possible. The grid
        // fills in as they arrive rather than blocking on the whole folder.
        for (const item of items) {
          thumbnail(item)
            .then((url) => setThumbs((prev) => ({ ...prev, [item.name]: url })))
            .catch(() => {});
        }
      } catch (e) {
        // The picker throwing AbortError just means the dialog was dismissed.
        if (e instanceof DOMException && e.name === "AbortError") return;
        setLibError(e instanceof Error ? e.message : String(e));
      }
    },
    [attachArtwork, doc],
  );

  const placeImage = useCallback(
    async (name: string, src: "library" | "upload") => {
      try {
        const img = src === "upload" ? await loadUpload(name) : await loadFromLibrary(name);
        setAssets((prev) => (prev ? { ...prev, images: { ...prev.images, [name]: img } } : prev));
        addNew(newImage(name, src, { name: src === "upload" ? name.replace(/^upload:/, "") : name }));
      } catch (e) {
        setLibError(e instanceof Error ? e.message : String(e));
      }
    },
    [addNew],
  );

  const takeFiles = useCallback(
    async (files: FileList | File[]) => {
      setLibError(null);
      for (const file of Array.from(files)) {
        try {
          const item = await addUpload(file);
          const img = await loadUpload(item.id);
          setAssets((prev) => (prev ? { ...prev, images: { ...prev.images, [item.id]: img } } : prev));
          addNew(newImage(item.id, "upload", { name: item.name }));
          uploadThumb(item.id)
            .then((url) => setThumbs((prev) => ({ ...prev, [item.id]: url })))
            .catch(() => {});
        } catch (e) {
          setLibError(e instanceof Error ? e.message : String(e));
        }
      }
      listUploads().then(setUploads).catch(() => {});
    },
    [addNew],
  );

  useEffect(() => {
    for (const u of uploads) {
      if (thumbs[u.id]) continue;
      uploadThumb(u.id)
        .then((url) => setThumbs((prev) => ({ ...prev, [u.id]: url })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads]);

  /* --------------------------------------------------- designs and presets */

  const doSave = async () => {
    const name = designName.trim() || content.headline.trim().slice(0, 60) || "Untitled";
    await saveDesign(name, { ...doc, updated: Date.now(), format: format.key });
    setDesigns(await listDesigns());
    setDesignName("");
    setSaveNote(`Saved "${name}"`);
    window.setTimeout(() => setSaveNote(null), 2500);
  };

  const doLoad = async (id: string) =>
    applyDesign(hydrate(await loadDesign(id), DEFAULT_CONTENT, formats));

  const savePresetNow = async () => {
    const name = presetName.trim() || `${format.label} arrangement`;
    await savePreset(name, {
      updated: Date.now(),
      transforms: content.transforms,
      inkOverrides: content.inkOverrides,
      layers: content.layers,
      buzz: content.buzz,
      colorway: colorway.key,
      ink: doc.ink,
      curtain: doc.curtain,
    });
    setPresets(await listPresets());
    setPresetName("");
    setSaveNote(`Saved preset "${name}"`);
    window.setTimeout(() => setSaveNote(null), 2500);
  };

  const applyPreset = async (id: string) => {
    const pr = hydratePreset(await loadPreset(id));
    if (!pr) return;
    /* The words are left alone on purpose - that is what separates a preset from
       a saved design. It lands as ONE undo step rather than five, because
       "apply preset" is one thing you did. */
    commit((d) => {
      const patch = {
        transforms: pr.transforms,
        inkOverrides: pr.inkOverrides,
        layers: pr.layers,
        buzz: pr.buzz,
      };
      if (scope === "all") {
        const overrides: Record<string, Partial<SocialAdContent>> = {};
        for (const [key, p] of Object.entries(d.overrides)) {
          const rest = { ...p };
          for (const k of Object.keys(patch)) delete rest[k as keyof SocialAdContent];
          if (Object.keys(rest).length) overrides[key] = rest;
        }
        return { ...d, shared: { ...d.shared, ...patch }, colorway: pr.colorway, ink: pr.ink, curtain: pr.curtain, overrides };
      }
      return {
        ...d,
        colorway: pr.colorway,
        ink: pr.ink,
        curtain: pr.curtain,
        overrides: { ...d.overrides, [format.key]: { ...(d.overrides[format.key] ?? {}), ...patch } },
      };
    });
    setSelected(null);
    void attachArtwork({ ...doc.shared, layers: pr.layers }, doc.overrides);
  };

  const addSize = () => {
    const w = Number(newSize.w);
    const h = Number(newSize.h);
    const bad = formatProblem(newSize.label, w, h);
    setSizeError(bad);
    if (bad) return;
    const made: Format = {
      key: customKey(),
      label: newSize.label.trim(),
      where: "Custom size",
      w: Math.round(w),
      h: Math.round(h),
    };
    const next = [...custom, made];
    setCustom(next);
    void saveFormats(next);
    setNewSize({ label: "", w: "1080", h: "1080" });
    // Switch to it: you added a size because you want to work in it.
    setFormat(made);
  };

  /* Removing a size also removes the per-format work done in it, because
     hydrate() will not recognise the key next time either. That is the right
     call for a deliberate delete - the alternative is a ghost override on a
     format nobody can select - but it is worth doing loudly rather than
     silently, so the overrides go now rather than at the next page load. */
  const removeSize = (f: Format) => {
    const next = custom.filter((c) => c.key !== f.key);
    setCustom(next);
    void saveFormats(next);
    if (format.key === f.key) setFormat(FORMATS[0]);
    if (doc.overrides[f.key]) {
      commit((d) => {
        const overrides = { ...d.overrides };
        delete overrides[f.key];
        return { ...d, overrides };
      });
    }
  };

  const removePreset = async (id: string) => {
    await deletePreset(id);
    setPresets(await listPresets());
  };

  const doDelete = async (id: string) => {
    await deleteDesign(id);
    setDesigns(await listDesigns());
  };

  /* ------------------------------------------------------------- the view */

  const missingArt = assets === null
    ? []
    : artworkNames(doc.shared, doc.overrides).filter((r) => !assets.images[r.name]);
  const missingFolder = missingArt.filter((r) => r.src === "library").length;
  const missingUploads = missingArt.filter((r) => r.src === "upload").length;

  const active = findLayer(content.layers, selected);
  const selectedLabel = selected ? (LABELS[selected] ?? active?.name ?? "Selected") : "";
  const selectedRegion = regions.find((r) => r.id === selected) ?? null;

  /* What can carry ink at all. Text never boils - that is the rule, not a
     default - so offering a toggle on a headline would be offering a control
     that cannot do anything. */
  const canInk = (id: string) =>
    !["headline", "body"].includes(id) && active?.kind !== "text";

  const clearField = (k: keyof SocialAdContent) =>
    commit((d) => {
      const { [k]: _drop, ...rest } = d.overrides[format.key] ?? {};
      const overrides = { ...d.overrides };
      if (Object.keys(rest).length) overrides[format.key] = rest;
      else delete overrides[format.key];
      return { ...d, overrides };
    });

  const resetFormat = () =>
    commit((d) => {
      const overrides = { ...d.overrides };
      delete overrides[format.key];
      return { ...d, overrides };
    });

  /* Aligning needs each element's WIDTH, which only the last draw knows - so it
     works off the reported regions rather than a second copy of the layout
     maths, the same rule hit-testing follows.

     WHAT IT ALIGNS TO depends on how many things are selected, which is the
     convention every design tool uses and the only one that is useful: one
     element has nothing to align to but the artboard, and several have each
     other. Aligning a group of six to the artboard's left margin would stack
     them all on top of each other, which is never what "align left" means when
     you have six things selected. */
  const alignTo = (edge: "left" | "cx" | "right" | "top" | "cy" | "bottom") => {
    const chosen = regions.filter((r) => selection.includes(r.id) && !manip.locked(r.id));
    if (!chosen.length) return;
    const m = Math.min(format.w, format.h) * 0.075;

    let bounds: { x0: number; y0: number; x1: number; y1: number };
    if (chosen.length === 1) {
      bounds = { x0: m, y0: m, x1: format.w - m, y1: format.h - m };
    } else {
      bounds = {
        x0: Math.min(...chosen.map((r) => r.cx - r.w / 2)),
        y0: Math.min(...chosen.map((r) => r.cy - r.h / 2)),
        x1: Math.max(...chosen.map((r) => r.cx + r.w / 2)),
        y1: Math.max(...chosen.map((r) => r.cy + r.h / 2)),
      };
    }

    for (const r of chosen) {
      const at = manip.pos(r.id, { x: r.cx / format.w, y: r.cy / format.h });
      const next = { ...at };
      if (edge === "left") next.x = (bounds.x0 + r.w / 2) / format.w;
      if (edge === "right") next.x = (bounds.x1 - r.w / 2) / format.w;
      if (edge === "cx") next.x = chosen.length === 1 ? 0.5 : (bounds.x0 + bounds.x1) / 2 / format.w;
      if (edge === "top") next.y = (bounds.y0 + r.h / 2) / format.h;
      if (edge === "bottom") next.y = (bounds.y1 - r.h / 2) / format.h;
      if (edge === "cy") next.y = chosen.length === 1 ? 0.5 : (bounds.y0 + bounds.y1) / 2 / format.h;
      manip.setPos(r.id, next.x, next.y);
    }
  };

  /* Even spacing, by CENTRE rather than by gap.
     Gap-spacing is what you want when the things are the same size and what
     surprises you when they are not: three items of different widths spaced by
     gap have centres that are not evenly spaced, which is usually the thing the
     eye was actually asking for. Centre-spacing is the unambiguous one, and the
     outermost two never move - they define the run. */
  const distribute = (axis: "x" | "y") => {
    const chosen = regions
      .filter((r) => selection.includes(r.id) && !manip.locked(r.id))
      .sort((a, b) => (axis === "x" ? a.cx - b.cx : a.cy - b.cy));
    if (chosen.length < 3) return;
    const first = axis === "x" ? chosen[0].cx : chosen[0].cy;
    const last = axis === "x" ? chosen[chosen.length - 1].cx : chosen[chosen.length - 1].cy;
    const step = (last - first) / (chosen.length - 1);
    chosen.forEach((r, i) => {
      if (i === 0 || i === chosen.length - 1) return;
      const at = manip.pos(r.id, { x: r.cx / format.w, y: r.cy / format.h });
      const target = first + step * i;
      manip.setPos(
        r.id,
        axis === "x" ? target / format.w : at.x,
        axis === "y" ? target / format.h : at.y,
      );
    });
  };

  if (error) return <div className="boot-msg">Could not load brand assets: {error}</div>;
  if (!assets) return <div className="boot-msg">Loading brand assets&hellip;</div>;

  const pct = (v: number) => Math.round(v * 1000) / 10;

  return (
    <div className="studio">
      <aside className="panel">
        <div className="head">
          <div>
            <h1>Social ad</h1>
            <p className="sub">Pick a format. Switch any time.</p>
          </div>
          <div className="tools">
            <button
              type="button"
              className="tool"
              title="Undo (cmd-Z)"
              disabled={!canUndo(hist)}
              onClick={doUndo}
            >
              &#8630;
            </button>
            <button
              type="button"
              className="tool"
              title="Redo (cmd-shift-Z)"
              disabled={!canRedo(hist)}
              onClick={doRedo}
            >
              &#8631;
            </button>
          </div>
        </div>

        <h2>Add</h2>
        <div className="row">
          <button type="button" className="ghost" onClick={() => addNew(newText({ color: colorway.ink }))}>
            Text
          </button>
          {SHAPES.map((s) => (
            <button
              key={s.key}
              type="button"
              className="ghost"
              onClick={() => addNew(newShape(s.key, s.key === "starburst" ? { fill: colorway.ctas[0] } : {}))}
            >
              {s.label}
            </button>
          ))}
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            Upload image
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void takeFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <p className="hint">
          Everything you add is a layer: dragged, resized, rotated and stacked. The template&rsquo;s
          own five &mdash; headline, supporting line, badge, BUZZ, wordmark &mdash; behave the same
          way, they just start where the layout put them.
        </p>

        {selection.length > 1 && (
          <>
            <h2>
              {selection.length} selected
              <button type="button" className="undo" title="Deselect (esc)" onClick={() => setSelection([])}>
                done
              </button>
            </h2>
            <div className="aligns">
              {ALIGNS.map(([edge, glyph, title]) => (
                <button key={edge} type="button" className="ghost" title={title} onClick={() => alignTo(edge)}>
                  {glyph}
                </button>
              ))}
            </div>
            {selection.length > 2 && (
              <div className="row">
                <button type="button" className="ghost" onClick={() => distribute("x")}>
                  Space across
                </button>
                <button type="button" className="ghost" onClick={() => distribute("y")}>
                  Space down
                </button>
              </div>
            )}
            <div className="row">
              <button
                type="button"
                className="ghost"
                onClick={() => duplicateMany(selection.filter((id) => findLayer(content.layers, id)))}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => dropMany(selection.filter((id) => findLayer(content.layers, id)))}
              >
                Delete
              </button>
            </div>
            <p className="hint">
              Align and spacing work on the selection&rsquo;s own bounds when there is more than one
              thing in it &mdash; aligning six things to the artboard&rsquo;s left margin would stack
              them on top of each other. Duplicate and delete skip the template&rsquo;s five, which
              are part of the composition rather than things you added.
            </p>
          </>
        )}

        {selected && (
          <>
            <h2>
              {selectedLabel}
              {active && (
                <button
                  type="button"
                  className="undo"
                  title="Deselect (esc)"
                  onClick={() => setSelected(null)}
                >
                  done
                </button>
              )}
            </h2>

            <div className="aligns">
              {ALIGNS.map(([edge, glyph, title]) => (
                <button key={edge} type="button" className="ghost" title={title} onClick={() => alignTo(edge)}>
                  {glyph}
                </button>
              ))}
            </div>

            {active?.kind === "text" && (
              <>
                <label>
                  Words
                  <textarea
                    ref={textRef}
                    rows={3}
                    value={active.text}
                    onChange={(e) => patchLayer(active.id, { text: e.target.value }, `text:${active.id}`)}
                  />
                </label>
                <label>
                  Typeface
                  <select
                    value={active.face}
                    onChange={(e) => patchLayer(active.id, { face: e.target.value as Face })}
                  >
                    {FACES.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="modes small">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={active.align === a ? "mode on" : "mode"}
                      onClick={() => patchLayer(active.id, { align: a })}
                    >
                      {a === "left" ? "Left" : a === "center" ? "Centre" : "Right"}
                    </button>
                  ))}
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={active.caps}
                    onChange={(e) => patchLayer(active.id, { caps: e.target.checked })}
                  />
                  <span>All caps</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={active.balance}
                    onChange={(e) => patchLayer(active.id, { balance: e.target.checked })}
                  />
                  <span>Balance the wrap</span>
                </label>
                <label>
                  Type size
                  <input
                    type="range"
                    min={10}
                    max={400}
                    value={Math.round(active.size * 1000)}
                    onChange={(e) => patchLayer(active.id, { size: Number(e.target.value) / 1000 }, `size:${active.id}`)}
                  />
                </label>
                <label>
                  Measure
                  <input
                    type="range"
                    min={5}
                    max={200}
                    value={Math.round(active.w * 100)}
                    onChange={(e) => patchLayer(active.id, { w: Number(e.target.value) / 100 }, `size:${active.id}`)}
                  />
                </label>
                <span className="lbl">Colour</span>
                <Swatches value={active.color} onChange={(k) => k && patchLayer(active.id, { color: k })} />
                <span className="lbl">Outline</span>
                <Swatches
                  none
                  value={active.outline}
                  onChange={(k) => patchLayer(active.id, { outline: k })}
                />
              </>
            )}

            {active?.kind === "shape" && (
              <>
                <label>
                  Shape
                  <select
                    value={active.shape}
                    onChange={(e) => patchLayer(active.id, { shape: e.target.value as ShapeKind })}
                  >
                    {SHAPES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                {active.shape === "starburst" && (
                  <label>
                    Label
                    <input
                      value={active.label}
                      onChange={(e) => patchLayer(active.id, { label: e.target.value }, `text:${active.id}`)}
                    />
                  </label>
                )}
                <span className="lbl">Fill</span>
                <Swatches none value={active.fill} onChange={(k) => patchLayer(active.id, { fill: k })} />
                <span className="lbl">Line</span>
                <Swatches none value={active.stroke} onChange={(k) => patchLayer(active.id, { stroke: k })} />
                <label>
                  Line weight
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={Math.round(active.strokeWidth * 1000)}
                    onChange={(e) => patchLayer(active.id, { strokeWidth: Number(e.target.value) / 1000 })}
                  />
                </label>
                {active.shape === "rect" && (
                  <label>
                    Corner radius
                    <input
                      type="range"
                      min={0}
                      max={50}
                      value={Math.round(active.radius * 100)}
                      onChange={(e) => patchLayer(active.id, { radius: Number(e.target.value) / 100 })}
                    />
                  </label>
                )}
              </>
            )}

            {active?.kind === "image" && (
              <div className="row">
                <button
                  type="button"
                  className={active.flipX ? "ghost on" : "ghost"}
                  onClick={() => patchLayer(active.id, { flipX: !active.flipX })}
                >
                  Flip across
                </button>
                <button
                  type="button"
                  className={active.flipY ? "ghost on" : "ghost"}
                  onClick={() => patchLayer(active.id, { flipY: !active.flipY })}
                >
                  Flip down
                </button>
              </div>
            )}

            {active?.kind !== "text" && (
              <label>
                Size
                <input
                  type="range"
                  min={selected === "wordmark" ? Math.round(minMarkScale(format) * 100) : active ? 1 : 20}
                  max={active ? 200 : 250}
                  value={Math.round(manip.scale(selected) * 100)}
                  onChange={(e) => manip.setScale(selected, Number(e.target.value) / 100)}
                />
                {selected === "wordmark" && (
                  <em className="floor">
                    Stops at {Math.round(minMarkScale(format) * 100)}% &mdash; below that the arrow-I
                    signpost stops reading.
                  </em>
                )}
              </label>
            )}
            <label>
              Rotation
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(manip.rot(selected))}
                onChange={(e) => manip.setRot(selected, Number(e.target.value))}
              />
            </label>
            {active && (
              <label>
                Opacity
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(active.opacity * 100)}
                  onChange={(e) => patchLayer(active.id, { opacity: Number(e.target.value) / 100 })}
                />
              </label>
            )}
            {selectedRegion && (
              <p className="hint">
                {Math.round(selectedRegion.w)} &times; {Math.round(selectedRegion.h)}px at{" "}
                {pct(selectedRegion.cx / format.w)}%, {pct(selectedRegion.cy / format.h)}%. Arrow keys
                nudge a pixel, shift ten. Hold alt while dragging to ignore the guides.
              </p>
            )}

            {canInk(selected) && (
              <>
                <div className="modes small">
                  {(
                    [
                      [null, "Default"],
                      ["off", "Off"],
                      ["still", "Still"],
                      ["live", "Boil"],
                    ] as [InkMode | null, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={label}
                      type="button"
                      className={
                        (active ? active.ink : (content.inkOverrides[selected] ?? null)) === mode
                          ? "mode on"
                          : "mode"
                      }
                      onClick={() =>
                        active ? patchLayer(active.id, { ink: mode }) : setElementInk(selected, mode)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="hint">Ink for this element. Default follows the setting below.</p>
              </>
            )}

            <div className="row">
              {!active && content.transforms[selected] && (
                <button type="button" className="ghost" onClick={() => clearTransform(selected)}>
                  Back to auto
                </button>
              )}
              {active && (
                <>
                  <button type="button" className="ghost" onClick={() => duplicateMany([active.id])}>
                    Duplicate
                  </button>
                  <button type="button" className="ghost" onClick={() => dropLayer(active.id)}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {content.layers.length > 0 && (
          <>
            <h2>Layers</h2>
            <ul className="layers">
              {/* Topmost first, because that is the order they sit in front of
                  you - the list reads down into the artboard. */}
              {[...content.layers].reverse().map((l) => (
                <li key={l.id} className={selection.includes(l.id) ? "on" : undefined}>
                  <button
                    type="button"
                    className="open"
                    title="Shift-click to add to the selection"
                    onClick={(e) =>
                      setSelection((sel) =>
                        e.shiftKey
                          ? sel.includes(l.id)
                            ? sel.filter((x) => x !== l.id)
                            : [...sel, l.id]
                          : [l.id],
                      )
                    }
                  >
                    <strong>{l.kind === "text" ? l.text.slice(0, 28) || "Text" : l.name}</strong>
                    <span>{l.kind}</span>
                  </button>
                  <button
                    type="button"
                    className="undo"
                    title={l.hidden ? "Show" : "Hide"}
                    onClick={() => patchLayer(l.id, { hidden: !l.hidden })}
                  >
                    {l.hidden ? "○" : "●"}
                  </button>
                  <button
                    type="button"
                    className="undo"
                    title={l.locked ? "Unlock" : "Lock"}
                    onClick={() => patchLayer(l.id, { locked: !l.locked })}
                  >
                    {l.locked ? "■" : "□"}
                  </button>
                  <button type="button" className="undo" title="Bring forward (cmd-])" onClick={() => restack(l.id, 1)}>
                    &uarr;
                  </button>
                  <button type="button" className="undo" title="Send back (cmd-[)" onClick={() => restack(l.id, -1)}>
                    &darr;
                  </button>
                  <button type="button" className="undo" title="Delete" onClick={() => dropLayer(l.id)}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <Section title="Content" open>
        <div className="scope" data-scope={scope}>
          <button
            type="button"
            className={scope === "all" ? "sc on" : "sc"}
            onClick={() => setScope("all")}
          >
            All formats
          </button>
          <button
            type="button"
            className={scope === "format" ? "sc on" : "sc"}
            onClick={() => setScope("format")}
          >
            {format.label} only
          </button>
        </div>
        {scope === "format" && (
          <p className="hint warn">
            Changes below apply to <strong>{format.label}</strong> alone. Everything else keeps the
            shared value.
          </p>
        )}

        <Field label="Headline" name="headline" overridden={overridden} onClear={clearField}>
          <textarea
            rows={3}
            value={content.headline}
            onChange={(e) => edit("headline", e.target.value, "text:headline")}
          />
        </Field>
        <Field label="Supporting line" name="body" overridden={overridden} onClear={clearField}>
          <textarea
            rows={3}
            value={content.body}
            onChange={(e) => edit("body", e.target.value, "text:body")}
          />
        </Field>
        <Field label="Call to action" name="cta" overridden={overridden} onClear={clearField}>
          <input value={content.cta} onChange={(e) => edit("cta", e.target.value, "text:cta")} />
        </Field>
        <Field label="BUZZ" name="buzz" overridden={overridden} onClear={clearField}>
          <select value={content.buzz} onChange={(e) => edit("buzz", e.target.value as BuzzPose)}>
            {BUZZ_POSES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        </Section>
        <Section title="Color">
        <div className="swatches">
          {COLORWAYS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={c.key === colorway.key}
              className={c.key === colorway.key ? "sw on" : "sw"}
              onClick={() => commit((d) => ({ ...d, colorway: c.key }))}
              style={{
                background: PALETTE[c.ground],
                color: PALETTE[c.ink],
                borderColor: PALETTE[c.accent],
              }}
            >
              <span style={{ background: PALETTE[c.ctas[0]] }} />
            </button>
          ))}
        </div>
        <p className="hint">
          Grounds, ink and action colors are paired for you. Alert Red is not offered on the warm
          grounds &mdash; it measured 1.23:1 on rust, which is invisible.
        </p>

        </Section>
        <Section title="Ink">
        <div className="modes">
          {(
            [
              ["off", "Off", "Straight machine edges."],
              ["still", "Still", "Hand-drawn wonk, drawn once and held."],
              ["live", "Boil", "The three phases cycling, about 8fps."],
            ] as [InkMode, string, string][]
          ).map(([key, label, why]) => (
            <button
              key={key}
              type="button"
              title={why}
              className={doc.ink === key ? "mode on" : "mode"}
              onClick={() => commit((d) => ({ ...d, ink: key }))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          Same three states as the line in the CRM. <strong>Still is not the boil off</strong>
          &mdash; it is one phase of it held, which is what a PNG should carry.
        </p>

        </Section>
        <Section title="Motion">
        <label className="check">
          <input
            type="checkbox"
            checked={animate}
            onChange={(e) => setAnimate(e.target.checked)}
            disabled={doc.ink !== "live"}
          />
          <span>Animate previews</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={doc.curtain}
            onChange={(e) => commit((d) => ({ ...d, curtain: e.target.checked }))}
          />
          <span>Curtain wipe</span>
        </label>
        <p className="hint">
          Text never boils and BUZZ never warps &mdash; he gets a misregistered silhouette instead.
          MP4 is {LOOP_FRAMES / FPS}s at {FPS}fps, looping, and the wipe only exists there.
        </p>

        </Section>
        <Section title="Artwork">
        {uploads.length > 0 && (
          <>
            <div className="tray">
              {uploads.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="chip"
                  title={`${u.name} - click to place, shift-click to remove from this browser`}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      void deleteUpload(u.id).then(() => listUploads().then(setUploads));
                      return;
                    }
                    void placeImage(u.id, "upload");
                  }}
                >
                  {thumbs[u.id] ? <img src={thumbs[u.id]} alt="" /> : <span />}
                </button>
              ))}
            </div>
            <p className="hint">
              Uploaded, so they live in this browser rather than in a folder &mdash; which is why
              they work on the phone. Shift-click one to remove it.
            </p>
          </>
        )}
        {!LIBRARY_SUPPORTED ? (
          <p className="hint">
            Reading a <em>folder</em> needs desktop Chrome or Edge &mdash; no mobile browser supports
            it. Upload works everywhere.
          </p>
        ) : !folder ? (
          <>
            <div className="row">
              {saved && (
                <button type="button" className="ghost" onClick={() => openLibrary(false)}>
                  Reconnect &ldquo;{saved}&rdquo;
                </button>
              )}
              <button type="button" className="ghost" onClick={() => openLibrary(true)}>
                {saved ? "Change folder" : "Choose folder"}
              </button>
            </div>
            <p className="hint">
              Point this at a folder of your own arrows, stars and illustrations. Nothing in it is
              read until you ask for it. Edit a file and save &mdash; the tool sees the new version,
              because it holds a pointer to the folder rather than a copy of it.
              {saved && " Chrome needs one click to restore access after a refresh."}
            </p>
          </>
        ) : (
          <>
            <div className="row">
              <span className="folder">{folder}</span>
              <button type="button" className="ghost" onClick={() => openLibrary(true)}>
                Change
              </button>
            </div>
            {lib.length === 0 ? (
              <p className="hint">No images in that folder yet. PNG, WebP, JPEG, GIF or SVG.</p>
            ) : (
              <div className="tray">
                {lib.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className="chip"
                    title={item.name}
                    onClick={() => void placeImage(item.name, "library")}
                  >
                    {thumbs[item.name] ? <img src={thumbs[item.name]} alt="" /> : <span />}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {libError && <p className="hint bad">{libError}</p>}
        {missingArt.length > 0 && (
          <p className="hint warn">
            {missingFolder > 0 && (
              <>
                {missingFolder} from a folder {folder ? "could not be found in it" : "need the folder connected"}.{" "}
              </>
            )}
            {missingUploads > 0 && (
              <>{missingUploads} was uploaded into another browser, so it is not here. </>
            )}
            Their place in the design is kept either way.
          </p>
        )}

        </Section>
        <Section title="Format" open>
        <div className="formats">
          {formats.map((f) => (
            <div className="fmt-row" key={f.key}>
              <button
                type="button"
                className={f.key === format.key ? "fmt on" : "fmt"}
                onClick={() => setFormat(f)}
              >
                <strong>
                  {f.label}
                  {doc.overrides[f.key] && <i className="dot" title="Has its own changes" />}
                </strong>
                <span>{f.where}</span>
                <em>
                  {f.w} &times; {f.h}
                </em>
              </button>
              {isCustom(f) && (
                <button
                  type="button"
                  className="undo"
                  title={`Remove ${f.label}${doc.overrides[f.key] ? " and the changes made in it" : ""}`}
                  onClick={() => removeSize(f)}
                >
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
        <details className="adder">
          <summary>Add a size</summary>
          <div className="row">
            <input
              placeholder="What it is for"
              value={newSize.label}
              onChange={(e) => setNewSize((n) => ({ ...n, label: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSize();
              }}
            />
          </div>
          <div className="row">
            <input
              className="side"
              inputMode="numeric"
              aria-label="Width in pixels"
              value={newSize.w}
              onChange={(e) => setNewSize((n) => ({ ...n, w: e.target.value }))}
            />
            <span className="by">&times;</span>
            <input
              className="side"
              inputMode="numeric"
              aria-label="Height in pixels"
              value={newSize.h}
              onChange={(e) => setNewSize((n) => ({ ...n, h: e.target.value }))}
            />
            <button type="button" className="ghost" onClick={addSize}>
              Add
            </button>
          </div>
          {sizeError && <p className="hint bad">{sizeError}</p>}
          <p className="hint">
            Named for the job, like the rest &mdash; &ldquo;Client one-pager&rdquo;, not
            &ldquo;1080&times;1350&rdquo;. The layout branches on the SHAPE, so a size you add
            composes itself correctly without anything being written for it.
          </p>
        </details>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="ghost" onClick={autoArrange}>
            Auto-arrange
          </button>
        </div>
        <p className="hint">
          Auto-arrange puts the template&rsquo;s five back to what the layout would do here. Layers
          are left alone &mdash; they were never in the layout, so it has nothing to say about them.
        </p>
        {doc.overrides[format.key] ? (
          <p className="hint">
            <button type="button" className="undo" onClick={resetFormat}>
              Reset {format.label} to shared
            </button>
          </p>
        ) : (
          <p className="hint">
            A dot marks a format with changes of its own. Switching format re-lays out the same
            content &mdash; it is not a crop, so nothing gets cut off or stranded.
          </p>
        )}

        </Section>
        <Section title="Presets">
        <p className="hint">
          An arrangement and a look, without the words &mdash; the layout, sizes, ink, layers and
          colour. Load one onto whatever copy you have open.
        </p>
        <div className="row">
          <input
            placeholder="Name this arrangement"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void savePresetNow();
            }}
          />
          <button type="button" className="ghost" onClick={() => void savePresetNow()}>
            Save
          </button>
        </div>
        {presets.length > 0 && (
          <ul className="saved">
            {presets.map((pr) => (
              <li key={pr.id}>
                <button type="button" className="open" onClick={() => void applyPreset(pr.id)}>
                  <strong>{pr.name}</strong>
                  <span>{new Date(pr.updated).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  className="undo"
                  title="Delete this preset"
                  onClick={() => void removePreset(pr.id)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}

        </Section>
        <Section title="Designs">
        <p className="hint">
          Your work is kept as you go, so a reload costs nothing. Save it under a name to come back
          to it later.
        </p>
        <div className="row">
          <input
            placeholder="Name this design"
            value={designName}
            onChange={(e) => setDesignName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSave();
            }}
          />
          <button type="button" className="ghost" onClick={() => void doSave()}>
            Save
          </button>
        </div>
        {saveNote && <p className="hint">{saveNote}</p>}
        {designs.length > 0 && (
          <ul className="saved">
            {designs.map((d) => (
              <li key={d.id}>
                <button type="button" className="open" onClick={() => void doLoad(d.id)}>
                  <strong>{d.name}</strong>
                  <span>{new Date(d.updated).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  className="undo"
                  title="Delete this design"
                  onClick={() => void doDelete(d.id)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        </Section>
      </aside>

      <main className="stage">
        {held && (
          <div className="held">
            <img src={held} alt="Your finished asset" />
            <p>Press and hold the image to save it to your photos.</p>
            <button type="button" className="ghost" onClick={() => setHeld(null)}>
              Done
            </button>
          </div>
        )}
        {/* One artboard. The stage still takes a list, which is the seam a
            carousel view would arrive through - several slides of one format,
            side by side. */}
        <div className="solo">
          <Artboard
            key={format.key}
            size={format}
            colorway={colorway}
            content={content}
            assets={assets}
            animate={animate && doc.ink === "live"}
            curtain={doc.curtain}
            ink={doc.ink}
            selection={selection}
            onSelect={setSelection}
            onEdit={(id) => {
              setSelected(id);
              // Double-clicking a text layer means "let me type", so put the
              // caret where the typing goes rather than making it be hunted for.
              window.setTimeout(() => textRef.current?.focus(), 0);
            }}
            onRegions={setRegions}
            manip={manip}
            onHeld={COARSE ? setHeld : null}
          />
        </div>
      </main>
    </div>
  );
}
