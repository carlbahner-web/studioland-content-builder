import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLORWAYS,
  PALETTE,
  FORMATS,
  type Colorway,
  type Format,
  type PaletteKey,
} from "./brand.ts";
import { GRAIN_ALPHA, loadBrandFonts, loadImage, prepareGrain } from "./render.ts";
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
  faceOf,
  CROPS,
  reorderLayer,
  updateLayer,
  FACES,
  GRAIN_MODES,
  SHAPES,
  type Face,
  type Layer,
  type ShapeKind,
} from "./layers.ts";
import { LOOP_FRAMES, type Assets, type Design as DesignContent, type Region } from "./sheet.ts";
import { socialAdStarter, DEFAULT_COPY } from "./starters/socialAd.ts";
import { BRAND_ASSETS, minLayerWidth } from "./brandAssets.ts";
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
  setStartDesign,
  startDesign,
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
import { DEFAULT_CUTOUT } from "./cutout.ts";
import {
  customKey,
  formatProblem,
  isCustom,
  loadFormats,
  saveFormats,
} from "./formats.ts";
import "./studio.css";

const EMPTY: DesignContent = { layers: [] };

/* THE DOCUMENT: everything an undo step has to restore.
 *
 * The format is deliberately NOT in here. It is which view of the design you are
 * looking at, not something about the design, and putting it in would mean
 * cmd-Z sometimes switched format instead of taking back the edit you just made
 * - which is the behaviour that makes people stop trusting undo. It is still
 * saved with the draft, so reopening the tool puts you back where you were. */
type Doc = {
  shared: DesignContent;
  overrides: Record<string, Partial<DesignContent>>;
  colorway: string;
  ink: InkMode;
  curtain: boolean;
  /** Leave the ground unpainted, so a PNG carries real alpha. */
  transparent: boolean;
  /** The sheet's grain. 0.2 is the measured recipe; 0 is no paper at all. */
  grain: number;
};

const INITIAL: Doc = {
  shared: EMPTY,
  overrides: {},
  colorway: COLORWAYS[0].key,
  ink: "still",
  curtain: true,
  transparent: false,
  grain: GRAIN_ALPHA,
};

const contentOf = (d: Doc, formatKey: string): DesignContent => ({
  ...d.shared,
  ...(d.overrides[formatKey] ?? {}),
});

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
  /* Whether a draft was found at all, and which saved design opens a blank
     start. Both feed the seeding below. */
  const hadDraft = useRef(false);
  const seeded = useRef(false);
  const [startId, setStartId] = useState<string | null>(null);
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
  /* Writing in "all formats" scope also CLEARS this format's override.
   *
   * The rule used to be per field and is now per design, because there is only
   * one field left: a design is its layers. "All formats" therefore means what
   * it says - after it, no format is carrying a different stack - which is the
   * silent-divergence trap the markers exist to prevent. Re-overriding is one
   * switch away; a change that appeared to apply and did not is not
   * recoverable, because you never see it. */
  const editLayers = useCallback(
    (v: Layer[] | ((cur: Layer[]) => Layer[]), tag: string | null = null) => {
      commit((d) => {
        const cur = contentOf(d, format.key).layers;
        const layers = typeof v === "function" ? v(cur) : v;
        if (scope === "all") return { ...d, shared: { layers }, overrides: {} };
        return { ...d, overrides: { ...d.overrides, [format.key]: { layers } } };
      }, tag);
    },
    [commit, format.key, scope],
  );

  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  /* ----------------------------------------------------------- the layers */

  const patchLayer = useCallback(
    (id: string, patch: Partial<Layer>, tag: string | null = null) =>
      editLayers((ls) => updateLayer(ls, id, patch), tag),
    [editLayers],
  );

  const addNew = useCallback(
    (layer: Layer) => {
      editLayers((ls) => addLayer(ls, layer));
      setSelected(layer.id);
    },
    [editLayers],
  );

  /* Both of these take a LIST and land as ONE undo step, because "duplicate
     these four" and "delete these four" are each one thing you did. Looping a
     single-item helper would record four steps and make cmd-Z take four presses
     to put back what one press made. */
  const duplicateMany = useCallback(
    (ids: string[]) => {
      const made: string[] = [];
      editLayers((ls) => {
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
    [editLayers],
  );

  const dropMany = useCallback(
    (ids: string[]) => {
      editLayers((ls) => ls.filter((l) => !ids.includes(l.id)));
      setSelection((s) => s.filter((id) => !ids.includes(id)));
    },
    [editLayers],
  );

  const dropLayer = useCallback((id: string) => dropMany([id]), [dropMany]);

  const restack = useCallback(
    (id: string, delta: number) => editLayers((ls) => reorderLayer(ls, id, delta)),
    [editLayers],
  );

  /* ---------------------------------------------------- what the artboard
     is allowed to change, without knowing which kind of thing it holds */

  /* What the artboard is allowed to change.
   *
   * This used to translate between two storage shapes, because a template
   * element carried a scale MULTIPLIER against whatever the layout chose while
   * a layer carried its size outright. There is one shape now, so most of this
   * is a straight read and write. */
  const manip: Manipulator = useMemo(
    () => ({
      pos: (id, fallback) => {
        const l = findLayer(content.layers, id);
        return l ? { x: l.x, y: l.y } : fallback;
      },
      setPos: (id, x, y, tag) => patchLayer(id, { x, y }, tag ?? `drag:${id}`),
      scale: (id) => {
        const l = findLayer(content.layers, id);
        if (!l) return 1;
        return l.kind === "text" ? l.size : l.w;
      },
      setScale: (id, v, tag) => {
        const l = findLayer(content.layers, id);
        if (!l) return;
        const t = tag ?? `size:${id}`;
        // A corner is proportional, so the OTHER dimension follows by the same
        // ratio: a text box keeps its measure as the type grows, and a shape
        // keeps its proportions instead of turning into a different shape.
        if (l.kind === "text") {
          const r = v / (l.size || 1);
          patchLayer(id, { size: v, w: l.w * r }, t);
        } else if (l.kind === "shape") {
          const r = v / (l.w || 1);
          patchLayer(id, { w: v, h: l.h * r }, t);
        } else {
          /* The wordmark's floor, and it is enforced HERE because it belongs to
             the ARTWORK rather than to any slot: the bible's "so the arrow-I
             signpost stops reading" would be just as true of the same file
             dropped in from a desktop. Every path that can shrink an image goes
             through this one, so the limit cannot be walked around. */
          const floor = minLayerWidth(l.file, format);
          const w = Math.max(floor, v);
          if (l.frameH !== null) patchLayer(id, { w, frameH: l.frameH * (w / (l.w || 1)) }, t);
          else patchLayer(id, { w }, t);
        }
      },
      rot: (id) => findLayer(content.layers, id)?.rotation ?? 0,
      setRot: (id, deg, tag) => patchLayer(id, { rotation: deg }, tag ?? `rot:${id}`),
      extent: (id) => {
        const l = findLayer(content.layers, id);
        if (!l) return null;
        // A text box has a width you set and a height it works out; a shape has
        // both; a framed image has a crop you can reshape. Unframed artwork has
        // the aspect the artwork came with, and stretching it is not offered.
        if (l.kind === "text") return { w: l.w, h: null };
        if (l.kind === "shape") return { w: l.w, h: l.h };
        if (l.kind === "image" && l.frameH !== null) return { w: l.w, h: l.frameH };
        return null;
      },
      setExtent: (id, w, h, tag) => {
        const l = findLayer(content.layers, id);
        if (!l) return;
        const t = tag ?? `size:${id}`;
        if (l.kind === "text") patchLayer(id, { w }, t);
        else if (l.kind === "shape") patchLayer(id, { w, h }, t);
        else patchLayer(id, { w: Math.max(minLayerWidth(l.file, format), w), frameH: h }, t);
      },
      locked: (id) => findLayer(content.layers, id)?.locked === true,
      /* Only text layers can be typed into on the artboard. That used to also
         exclude the template's fitted headline, whose size moved as you typed;
         there is no such thing any more, so the exclusion is simply "this is
         not text". */
      editable: (id) => {
        const l = findLayer(content.layers, id);
        if (!l || l.kind !== "text" || l.locked) return null;
        const face = faceOf(l.face);
        const short = Math.min(format.w, format.h);
        const px = l.size * short;
        return {
          text: l.text,
          family: face.family,
          size: px,
          lineHeight: px * face.lineHeight,
          tracking: px * face.tracking,
          align: l.align,
          caps: l.caps,
          color: PALETTE[l.color] ?? PALETTE.offwhite,
          w: l.w * short,
          rotation: l.rotation,
          x: l.x,
          y: l.y,
        };
      },
      setText: (id, value) => patchLayer(id, { text: value }, `text:${id}`),
    }),
    [content, format, patchLayer],
  );

  /* ------------------------------------------------------------ the boot */

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        /* Brand artwork is loaded into the SAME map as folder files and
           uploads, under its own keys. There is no separate slot for BUZZ or
           the wordmark any more, because there is nothing that would read
           one - they are images a layer points at, like any other. */
        const [, grain, ...art] = await Promise.all([
          loadBrandFonts(),
          loadImage(assetUrl("/brand/grain.webp")),
          ...BRAND_ASSETS.map((a) => loadImage(assetUrl(a.path))),
        ]);
        if (!live) return;
        prepareGrain(grain);
        const images: Record<string, HTMLImageElement> = {};
        BRAND_ASSETS.forEach((a, i) => {
          images[a.key] = art[i];
        });
        setAssets({ images });
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
    async (sh: DesignContent, ov: Record<string, Partial<DesignContent>>) => {
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

  /* The standard social ad, composed for one artboard and handed back as
     layers. A 2D context is needed to fit the headline the way the old template
     did, so it is made here rather than guessed at. */
  const composeStarter = useCallback(
    (fmt: Format, cw: Colorway, copy = DEFAULT_COPY): Layer[] => {
      if (!assets) return [];
      const c = document.createElement("canvas").getContext("2d");
      return socialAdStarter(fmt, cw, assets.images, c, copy);
    },
    [assets],
  );

  const applyDesign = useCallback(
    (d: ReturnType<typeof hydrate>) => {
      if (!d) return;
      /* A design written before the roles were deleted arrives with five named
         fields and no layers. Compose the arrangement it described, then put
         back whatever had been moved, resized or turned - so an old design
         opens looking like itself rather than like an empty ground. */
      let shared = d.shared;
      if (d.legacy && !shared.layers.length) {
        const composed = composeStarter(d.format, d.colorway, d.legacy.copy);
        const byRole: Record<string, string> = {
          BUZZ: "buzz",
          Wordmark: "wordmark",
          Headline: "headline",
          "Supporting line": "body",
          "Call to action": "cta",
        };
        shared = {
          layers: composed.map((l) => {
            const role = byRole[l.name];
            const tr = role ? d.legacy!.transforms[role] : undefined;
            const ink = role ? (d.legacy!.ink[role] ?? null) : null;
            if (!tr && !ink) return l;
            const scaled = { ...l, ink };
            if (tr?.x !== undefined) scaled.x = tr.x;
            if (tr?.y !== undefined) scaled.y = tr.y;
            if (tr?.rotation !== undefined) scaled.rotation = tr.rotation;
            if (tr?.scale !== undefined && tr.scale !== 1) {
              if (scaled.kind === "text") {
                scaled.size *= tr.scale;
                scaled.w *= tr.scale;
              } else {
                scaled.w *= tr.scale;
                if (scaled.kind === "shape") scaled.h *= tr.scale;
              }
            }
            return scaled;
          }),
        };
      }
      /* RESET rather than push: the states before this belong to a different
         document, and undoing into them would take you out of the design you
         just opened with no way to tell what happened. */
      setHist((h) =>
        resetHistory(h, {
          shared,
          overrides: d.overrides,
          colorway: d.colorway.key,
          ink: d.ink,
          curtain: d.curtain,
          transparent: d.transparent,
          grain: d.grain,
        }),
      );
      setFormat(d.format);
      setSelected(null);
      setScope("all");
      void attachArtwork(shared, d.overrides);
    },
    [attachArtwork, composeStarter],
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
        const raw = await loadDraft();
        const d = hydrate(raw, EMPTY, known);
        hadDraft.current = d !== null;
        if (d) applyDesign(d);
      } finally {
        setRestored(true);
      }
    })();
    listDesigns().then(setDesigns).catch(() => {});
    listPresets().then(setPresets).catch(() => {});
    startDesign().then(setStartId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A BLANK START gets something on the artboard rather than an empty ground.
   *
   * Only on a blank start - the test is "was there a draft", not "is the
   * artboard empty". Deleting every layer and reloading has to give you back
   * the empty artboard you left, or the tool would keep undoing a deliberate
   * decision every time you refreshed.
   *
   * What it seeds is yours if you have said so: a saved design marked as the
   * starting point wins, and the standard arrangement is the fallback for
   * someone who has not chosen one yet. Neither is baked into the code, and
   * changing it means saving a design rather than shipping a build.
   *
   * It waits for the artwork, because composing needs BUZZ and the wordmark
   * decoded to size them - and it resets the history rather than pushing to it,
   * since this is the state you opened in rather than an edit you made. */
  useEffect(() => {
    if (!assets || !restored || seeded.current || hadDraft.current) return;
    seeded.current = true;
    (async () => {
      const chosen = await startDesign().catch(() => null);
      if (chosen) {
        const d = hydrate(await loadDesign(chosen), EMPTY, formats);
        // A starting design that has since been deleted falls through to the
        // standard arrangement rather than opening nothing.
        if (d) {
          applyDesign(d);
          return;
        }
      }
      const composed = composeStarter(format, colorway);
      if (composed.length) {
        setHist((h) => resetHistory(h, { ...h.present, shared: { layers: composed } }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, restored]);

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
    async (file: string, src: "library" | "upload" | "brand", label?: string) => {
      try {
        // Brand artwork is already decoded and in the map from boot.
        const img =
          src === "brand"
            ? assets?.images[file]
            : src === "upload"
              ? await loadUpload(file)
              : await loadFromLibrary(file);
        if (!img) throw new Error(`${label ?? file} is not loaded`);
        setAssets((prev) => (prev ? { ...prev, images: { ...prev.images, [file]: img } } : prev));
        addNew(newImage(file, src, label ? { name: label } : {}));
      } catch (e) {
        setLibError(e instanceof Error ? e.message : String(e));
      }
    },
    [addNew, assets],
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
    /* A design names itself after its first line of type if you do not, which
       is nearly always the headline - but it is found by looking rather than by
       asking a slot, because there are no slots. */
    const firstText = content.layers.find((l) => l.kind === "text" && l.text.trim());
    const name =
      designName.trim() ||
      (firstText && firstText.kind === "text" ? firstText.text.trim().slice(0, 60) : "") ||
      "Untitled";
    await saveDesign(name, { ...doc, updated: Date.now(), format: format.key });
    setDesigns(await listDesigns());
    setDesignName("");
    setSaveNote(`Saved "${name}"`);
    window.setTimeout(() => setSaveNote(null), 2500);
  };

  const doLoad = async (id: string) =>
    applyDesign(hydrate(await loadDesign(id), EMPTY, formats));

  const savePresetNow = async () => {
    const name = presetName.trim() || `${format.label} arrangement`;
    await savePreset(name, {
      updated: Date.now(),
      layers: content.layers,
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
    /* A preset now carries the whole stack, so applying one REPLACES the
       design's layers rather than merging an arrangement into named slots. It
       lands as one undo step, because "apply preset" is one thing you did.
       That it takes the words with it is a change from before, and an honest
       one: with no roles there is no way to tell which text was "the headline"
       and therefore no way to keep yours while taking someone else's layout. */
    commit((d) => ({
      ...d,
      shared: { layers: pr.layers },
      overrides: {},
      colorway: pr.colorway,
      ink: pr.ink,
      curtain: pr.curtain,
    }));
    setSelection([]);
    void attachArtwork({ layers: pr.layers }, {});
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
     silently, so the override goes now rather than at the next page load. */
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
    if (id === startId) setStartId(null);
  };

  /* ------------------------------------------------------------- the view */

  const missingArt = assets === null
    ? []
    : artworkNames(doc.shared, doc.overrides).filter((r) => !assets.images[r.name]);
  const missingFolder = missingArt.filter((r) => r.src === "library").length;
  const missingUploads = missingArt.filter((r) => r.src === "upload").length;

  const active = findLayer(content.layers, selected);
  const selectedLabel = active?.name ?? "Selected";
  const selectedRegion = regions.find((r) => r.id === selected) ?? null;

  /* Text never boils - that is the rule, not a default - so a text layer has no
     ink control at all rather than one that cannot do anything. */
  const canInk = active !== null && active.kind !== "text";

  /* Replace the stack with the standard social ad, composed for the shape you
     are in. This is what the template used to do on every draw, and it is the
     honest replacement for it: switching format no longer re-composes by
     itself, so re-composing is a thing you ask for and can undo. */
  /** A floor on how small this layer may go, in the units the slider works in. */
  const floorFor = (l: Layer): number =>
    l.kind === "image" ? minLayerWidth(l.file, format) : 0;

  const standardArrangement = () => {
    const composed = composeStarter(format, colorway);
    if (composed.length) {
      editLayers(composed);
      setSelection([]);
    }
  };

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
        </div>
        {/* The brand's own artwork, added the same way as anything else. BUZZ
            and the wordmark used to be slots the template owned; they are files
            now, and the only thing that still knows one of them is special is
            the wordmark's minimum size, which belongs to the artwork. */}
        <div className="row">
          {BRAND_ASSETS.map((a) => (
            <button
              key={a.key}
              type="button"
              className="ghost"
              onClick={() => void placeImage(a.key, "brand", a.label)}
            >
              {a.label}
            </button>
          ))}
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
          Everything on the artboard is a layer &mdash; dragged, resized, rotated, stacked, given
          its own paper, and deleted. There are no special pieces: BUZZ and the wordmark are
          artwork you add, the headline is text you type, the badge is a shape. Nothing here knows
          which is which.
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
              <>
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
                <span className="lbl">Background</span>
                <div className="row">
                  <button
                    type="button"
                    className={active.cutout ? "ghost" : "ghost on"}
                    onClick={() => patchLayer(active.id, { cutout: null })}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className={active.cutout ? "ghost on" : "ghost"}
                    onClick={() => patchLayer(active.id, { cutout: active.cutout ?? DEFAULT_CUTOUT })}
                  >
                    Remove
                  </button>
                </div>
                {active.cutout && (
                  <>
                    <label>
                      How much counts as background
                      <input
                        type="range"
                        min={1}
                        max={60}
                        value={Math.round(active.cutout.tolerance * 200)}
                        onChange={(e) =>
                          patchLayer(
                            active.id,
                            { cutout: { ...active.cutout!, tolerance: Number(e.target.value) / 200 } },
                            `cut:${active.id}`,
                          )
                        }
                      />
                    </label>
                    <label>
                      Edge softness
                      <input
                        type="range"
                        min={0}
                        max={6}
                        value={active.cutout.feather}
                        onChange={(e) =>
                          patchLayer(
                            active.id,
                            { cutout: { ...active.cutout!, feather: Number(e.target.value) } },
                            `cut:${active.id}`,
                          )
                        }
                      />
                    </label>
                    <p className="hint">
                      It floods in from the edges, so it only takes background that is
                      <em> connected to the border</em> &mdash; a white shirt against a white wall
                      keeps the shirt. It has no idea what a person is, though: a plain backdrop is
                      what it is for, and a cluttered room is not something more tolerance will fix.
                    </p>
                  </>
                )}
                <span className="lbl">Crop</span>
                <div className="row">
                  <button
                    type="button"
                    className={active.frameH === null ? "ghost on" : "ghost"}
                    /* Dropping the frame keeps the width, so the artwork springs
                       back to its own shape rather than to some remembered one. */
                    onClick={() => patchLayer(active.id, { frameH: null })}
                  >
                    Uncropped
                  </button>
                  {CROPS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      className={
                        active.frameH !== null &&
                        Math.abs(active.frameH / active.w - c.ratio) < 0.01
                          ? "ghost on"
                          : "ghost"
                      }
                      onClick={() => patchLayer(active.id, { frameH: active.w * c.ratio })}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {active.frameH !== null && (
                  <>
                    <label>
                      Zoom
                      <input
                        type="range"
                        min={100}
                        max={400}
                        value={Math.round(active.zoom * 100)}
                        onChange={(e) =>
                          patchLayer(active.id, { zoom: Number(e.target.value) / 100 }, `crop:${active.id}`)
                        }
                      />
                    </label>
                    <label>
                      Focus across
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(active.focusX * 100)}
                        onChange={(e) =>
                          patchLayer(active.id, { focusX: Number(e.target.value) / 100 }, `crop:${active.id}`)
                        }
                      />
                    </label>
                    <label>
                      Focus down
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(active.focusY * 100)}
                        onChange={(e) =>
                          patchLayer(active.id, { focusY: Number(e.target.value) / 100 }, `crop:${active.id}`)
                        }
                      />
                    </label>
                    <p className="hint">
                      The artwork fills the frame and is cropped, never squashed. Focus picks which
                      part of it sits in the middle; it stops where the frame would start showing
                      through, so a crop always stays filled. The side handles reshape the frame.
                    </p>
                  </>
                )}
              </>
            )}

            {active && active.kind !== "text" && (
              <label>
                Size
                <input
                  type="range"
                  min={Math.max(1, Math.round(floorFor(active) * 100))}
                  max={200}
                  value={Math.round(manip.scale(selected!) * 100)}
                  onChange={(e) => manip.setScale(selected!, Number(e.target.value) / 100)}
                />
                {floorFor(active) > 0 && (
                  <em className="floor">
                    Stops at {Math.round(floorFor(active) * 100)}% &mdash; below that the arrow-I
                    signpost stops reading. That is a rule about this artwork, so it holds wherever
                    the mark is used.
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

            {active && (
              <>
                <span className="lbl">Paper</span>
                <div className="modes small">
                  {GRAIN_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      title={m.why}
                      className={active.grain === m.key ? "mode on" : "mode"}
                      onClick={() => patchLayer(active.id, { grain: m.key })}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  It is the sheet&rsquo;s own grain either way, anchored to the artboard &mdash; so
                  a patch of it on this element lines up with the paper beside it rather than
                  reading as a texture stuck on top.
                </p>
              </>
            )}

            {canInk && (
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
                      className={active!.ink === mode ? "mode on" : "mode"}
                      onClick={() => patchLayer(active!.id, { ink: mode })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="hint">Ink for this element. Default follows the setting below.</p>
              </>
            )}

            {active && (
              <div className="row">
                <button type="button" className="ghost" onClick={() => duplicateMany([active.id])}>
                  Duplicate
                </button>
                <button type="button" className="ghost" onClick={() => dropLayer(active.id)}>
                  Delete
                </button>
              </div>
            )}
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
            <strong>{format.label}</strong> is carrying its own stack of layers. Everything else
            keeps the shared one.
          </p>
        )}

        <div className="row">
          <button type="button" className="ghost" onClick={standardArrangement}>
            Standard arrangement
          </button>
        </div>
        <p className="hint">
          Composes the standard social ad for this shape and hands it over as layers &mdash; a
          headline, BUZZ, the wordmark, a badge. Nothing it makes is special afterwards: every
          piece is an ordinary layer you can retype, restyle, move or delete. It replaces what is
          on the artboard, and it is one undo.
        </p>
        <p className="hint">
          Switching format re-scales what is here rather than re-composing it. Ask for the standard
          arrangement again to get a layout worked out for the shape you are now in.
        </p>

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
        <label className="check">
          <input
            type="checkbox"
            checked={doc.transparent}
            onChange={(e) => commit((d) => ({ ...d, transparent: e.target.checked }))}
          />
          <span>No ground &mdash; save with transparency</span>
        </label>
        <p className="hint">
          The ground goes unpainted and the PNG carries real alpha, for dropping onto someone
          else&rsquo;s slide or a photograph. The colourway still picks the ink, because you are
          still saying what the asset is <em>for</em> &mdash; you are only declining to paint the
          field behind it.{" "}
          {doc.transparent && (
            <strong>
              MP4 has no transparency anywhere in the browser, so the video export paints the ground
              back in.
            </strong>
          )}
        </p>
        {/* The colourway pairs ink TO A GROUND. Take the ground away and that
            pairing is still doing its job, but against whatever the asset gets
            dropped onto - which is usually pale. Worth saying at the moment it
            becomes true rather than leaving it to be discovered in a deck. */}
        {doc.transparent && colorway.ink === "offwhite" && (
          <p className="hint warn">
            This colourway inks in cream, which was chosen to sit on {colorway.label}. With no
            ground behind it, it will disappear on anything pale. <strong>BUZZ Off-White</strong>{" "}
            inks in charcoal and is the one to reach for here.
          </p>
        )}

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

        {/* Paper sits with ink because they are the same kind of thing: how
            this was printed, rather than what is on it. */}
        <label>
          Paper
          <input
            type="range"
            min={0}
            max={60}
            value={Math.round(doc.grain * 100)}
            onChange={(e) => commit((d) => ({ ...d, grain: Number(e.target.value) / 100 }))}
          />
        </label>
        <p className="hint">
          The press grain over the whole sheet. {Math.round(GRAIN_ALPHA * 100)}% is the measured
          recipe and where it starts; 0 takes the paper away entirely. Any layer can take more of it
          or none of it &mdash; select one and look under Paper.
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
                    void placeImage(u.id, "upload", u.name);
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
          <button type="button" className="ghost" onClick={standardArrangement}>
            Standard arrangement
          </button>
        </div>
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
          to it later. Star one and it is what opens on a blank start &mdash; a fresh browser, or
          after clearing this one &mdash; instead of the standard arrangement.
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
                  className={d.id === startId ? "undo on" : "undo"}
                  title={
                    d.id === startId
                      ? "Opens on a blank start. Click to stop."
                      : "Open this on a blank start"
                  }
                  onClick={() => {
                    const next = d.id === startId ? null : d.id;
                    setStartId(next);
                    void setStartDesign(next);
                  }}
                >
                  {d.id === startId ? "★" : "☆"}
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
            transparent={doc.transparent}
            grain={doc.grain}
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
