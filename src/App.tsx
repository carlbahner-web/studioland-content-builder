import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUZZ_POSES,
  COLORWAYS,
  PALETTE,
  FORMATS,
  type BuzzPose,
  type Colorway,
  type Format,
} from "./brand.ts";
import { loadBrandFonts, loadImage, prepareGrain } from "./render.ts";
import { FPS, type InkMode } from "./boil.ts";
import { assetUrl } from "./assets.ts";
import { saveFile } from "./save.ts";
import { encodeMp4 } from "./video.ts";
import {
  drawSocialAd,
  hitRegion,
  minMarkScale,
  LOOP_FRAMES,
  type Assets,
  type Region,
  type SocialAdContent,
  type Sticker,
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
import "./studio.css";

const DEFAULT_CONTENT: SocialAdContent = {
  headline: "Your mixes deserve a better client list",
  body: "StudioLand trains audio engineers to find and book the artists they actually want to work with.",
  cta: "Learn more",
  buzz: "wave",
  stickers: [],
  transforms: {},
  inkOverrides: {},
};

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

/* A programmatic download is not reliable everywhere.
 *
 * iOS Safari treats `<a download>` on a blob inconsistently - often opening the
 * image in a new tab instead of saving it - and a sandboxed iframe (a preview
 * embedded elsewhere) blocks it outright. On both, the gesture people actually
 * use is press-and-hold on the image itself.
 *
 * So on a coarse pointer the export ALSO puts the finished PNG on screen to be
 * held. Desktop, where the download simply works, is left alone rather than
 * given a panel to dismiss every time. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** Render a size to a fresh canvas and save it as a PNG. */
function downloadStill(
  size: Format,
  colorway: Colorway,
  content: SocialAdContent,
  assets: Assets,
  ink: InkMode,
  onImage?: (dataUrl: string) => void,
): void {
  const c = document.createElement("canvas");
  c.width = size.w;
  c.height = size.h;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  // A still never carries a frame index, so "live" holds the middle phase -
  // which is the drawing the flicker starts from, so a PNG and the first frame
  // of its MP4 are the same picture.
  drawSocialAd(ctx, size, colorway, content, assets, { ink });
  c.toBlob(async (blob) => {
    if (!blob) return;
    const how = await saveFile(`studioland-social-${size.key}-${colorway.key}.png`, blob);
    // Only fall back to press-and-hold where the browser download is the one
    // that ran AND is the unreliable kind. A confirmed save needs no follow-up.
    if (how === "browser" && onImage) onImage(c.toDataURL("image/png"));
  }, "image/png");
}

/** One preview card: a canvas at true output pixels, scaled down by CSS. */
function Preview({
  size,
  colorway,
  content,
  assets,
  animate,
  curtain,
  ink,
  onNudge,
  onDragSticker,
  onSelect,
}: {
  size: Format;
  colorway: Colorway;
  content: SocialAdContent;
  assets: Assets;
  animate: boolean;
  curtain: boolean;
  ink: InkMode;
  onNudge: (id: string, dx: number, dy: number) => void;
  onDragSticker: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* Regions come from the LAST DRAW rather than being recomputed here. The
     layout already knows where everything ended up; hit-testing against a
     second copy of that maths is how the two drift apart. */
  const regions = useRef<Region[]>([]);
  const drag = useRef<{
    id: string;
    sticker: boolean;
    /** Pointer at grab time, and the element's nudge at grab time. */
    px0: number;
    py0: number;
    nx0: number;
    ny0: number;
    ox: number;
    oy: number;
  } | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  /* Dragging works on ANY preview and moves the sticker on all of them, because
     positions are fractions of the artboard rather than pixels. */
  const toArtboard = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      px: ((e.clientX - r.left) / r.width) * size.w,
      py: ((e.clientY - r.top) / r.height) * size.h,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = toArtboard(e);
    const hit = hitRegion(regions.current, px, py);
    onSelect(hit?.id ?? null);
    if (!hit) return;
    const sticker = content.stickers.some((s) => s.id === hit.id);
    const tr = content.transforms[hit.id] ?? {};
    const n = { x: tr.x ?? hit.cx / size.w, y: tr.y ?? hit.cy / size.h };
    /* Both the grab offset and the current nudge are recorded, so a drag ADDS
       to where the element already was. Without the first the element jumps its
       centre under your finger; without the second every drag would restart
       from the layout position and throw away the last one. */
    drag.current = {
      id: hit.id,
      sticker,
      px0: px / size.w,
      py0: py / size.h,
      nx0: n.x,
      ny0: n.y,
      ox: (px - hit.cx) / size.w,
      oy: (py - hit.cy) / size.h,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { px, py } = toArtboard(e);
    if (d.sticker) {
      onDragSticker(d.id, px / size.w - d.ox, py / size.h - d.oy);
    } else {
      onNudge(d.id, d.nx0 + (px / size.w - d.px0), d.ny0 + (py / size.h - d.py0));
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!animate) {
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, { ink });
      return;
    }
    /* The preview is driven by the same frame INDEX the exporter uses, not by
       elapsed time, so what plays here is frame-for-frame what lands in the
       MP4 - just possibly at a different speed if the tab is busy. */
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const frame = Math.floor(((now - start) / 1000) * FPS) % LOOP_FRAMES;
      regions.current = drawSocialAd(ctx, size, colorway, content, assets, { frame, ink, curtain });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [size, colorway, content, assets, animate, curtain, ink]);

  const download = useCallback(() => {
    // Always render the STILL, never whatever frame the preview happens to be
    // showing. Capturing the live canvas mid-animation hands you a PNG of the
    // curtain half way across, which is not a thing anyone wants to post.
    downloadStill(size, colorway, content, assets, ink, COARSE ? setHeld : undefined);
  }, [size, colorway, content, assets, ink]);

  const exportMp4 = useCallback(async () => {
    // Encode off-screen so the visible preview keeps animating and the two
    // never contend for the same context.
    const off = document.createElement("canvas");
    off.width = size.w;
    off.height = size.h;
    const octx = off.getContext("2d");
    if (!octx) return;
    setBusy("0%");
    try {
      const { blob, codec } = await encodeMp4({
        width: size.w,
        height: size.h,
        frames: LOOP_FRAMES,
        canvas: off,
        draw: (frame) => drawSocialAd(octx, size, colorway, content, assets, { frame, ink, curtain }),
        onProgress: (done, total) => setBusy(`${Math.round((done / total) * 100)}%`),
      });
      await saveFile(`studioland-social-${size.key}-${colorway.key}.mp4`, blob);
      setBusy(codec.startsWith("H.264") ? null : `${codec} (no H.264 here)`);
      if (!codec.startsWith("H.264")) window.setTimeout(() => setBusy(null), 6000);
    } catch (e) {
      setBusy(e instanceof Error ? e.message : String(e));
      window.setTimeout(() => setBusy(null), 6000);
    }
  }, [size, colorway, content, assets, curtain, ink]);

  // A fact about the shape, not about one format's name.
  const reel = size.h / size.w > 1.7;

  return (
    <figure className="card">
      <figcaption>
        <div>
          <strong>
            {size.label}
            {reel && <em className="tag">Reel</em>}
          </strong>
          <span>
            {size.w} &times; {size.h} &middot; {size.where}
          </span>
        </div>
        <div className="acts">
          <button type="button" className="go" onClick={download}>
            Save PNG
          </button>
          <button type="button" onClick={exportMp4} disabled={busy !== null}>
            {busy ?? "MP4"}
          </button>
        </div>
      </figcaption>
      {/* The canvas is the real 1080px artboard; only its CSS box shrinks, so
          what you see is exactly what exports. */}
      {held && (
        <div className="held">
          <img src={held} alt="Your finished asset" />
          <p>Press and hold the image to save it to your photos.</p>
          <button type="button" className="ghost" onClick={() => setHeld(null)}>
            Done
          </button>
        </div>
      )}
      <canvas
        ref={ref}
        width={size.w}
        height={size.h}
        style={{ aspectRatio: `${size.w} / ${size.h}` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </figure>
  );
}

export default function App() {
  /* Content is a SHARED base plus per-format overrides, resolved at render.
   *
   * The scope toggle is deliberately modal, which is the one thing worth being
   * careful about: a change made in the wrong scope forks something quietly and
   * you find out later. So every bit of divergence is surfaced - a dot on any
   * format carrying overrides, a badge on any field overridden here, and resets
   * at both levels. The mode is loud when it is not the safe one. */
  const [shared, setShared] = useState<SocialAdContent>(DEFAULT_CONTENT);
  const [overrides, setOverrides] = useState<Record<string, Partial<SocialAdContent>>>({});
  const [scope, setScope] = useState<"all" | "format">("all");

  const [colorway, setColorway] = useState<Colorway>(COLORWAYS[0]);
  const [format, setFormat] = useState<Format>(FORMATS[0]);
  const content: SocialAdContent = { ...shared, ...(overrides[format.key] ?? {}) };
  const overridden = new Set(Object.keys(overrides[format.key] ?? {}));

  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ink, setInkChoice] = useState<InkMode>("still");
  const [lib, setLib] = useState<LibraryItem[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [designName, setDesignName] = useState("");
  const [restored, setRestored] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // Someone who has asked their machine for less movement should not be handed
  // four flickering canvases. The exports still animate - a file is not the UI.
  /* Previews hold still by default now that "still" is the default ink: the
     boil is a property of the asset, and watching it flicker is a thing you
     turn on to check the video, not the state you work in. */
  const [animate, setAnimate] = useState(false);
  const [curtain, setCurtain] = useState(true);

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
        setAssets({ buzz: { wave, ride }, wordmark: { cream, charcoal }, stickers: {} });
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
  }, []);

  /* Restore the draft once, before the first autosave can run. `restored` gates
     the writer below: without it the empty initial state would be written over
     the draft in the same tick the page opened, which is the classic way an
     autosave feature eats the thing it was added to protect. */
  useEffect(() => {
    loadDraft()
      .then((raw) => {
        const d = hydrate(raw, DEFAULT_CONTENT);
        if (d) applyDesign(d);
      })
      .finally(() => setRestored(true));
    listDesigns().then(setDesigns).catch(() => {});
    listPresets().then(setPresets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Autosave, debounced. Everything that makes the design what it is. */
  useEffect(() => {
    if (!restored) return;
    const id = window.setTimeout(() => {
      void saveDraft({
        updated: Date.now(),
        shared,
        overrides,
        colorway: colorway.key,
        format: format.key,
        ink,
        curtain,
      });
    }, 400);
    return () => window.clearTimeout(id);
  }, [restored, shared, overrides, colorway, format, ink, curtain]);

  /* Pull decoded images for every artwork name a design refers to. Called after
     a folder connects, which is the point a restored design's stickers can
     finally draw - before that they are names with nothing behind them. */
  const attachArtwork = async (
    sh: SocialAdContent,
    ov: Record<string, Partial<SocialAdContent>>,
  ) => {
    const names = artworkNames(sh, ov);
    if (!names.length) return;
    const loaded: Record<string, HTMLImageElement> = {};
    for (const name of names) {
      try {
        loaded[name] = await loadFromLibrary(name);
      } catch {
        // A file that has been renamed or deleted since. The sticker keeps its
        // place in the design and simply does not draw; saying so is the
        // Artwork panel's job, not a reason to drop it.
      }
    }
    setAssets((prev) => (prev ? { ...prev, stickers: { ...prev.stickers, ...loaded } } : prev));
  };

  const applyDesign = (d: ReturnType<typeof hydrate>) => {
    if (!d) return;
    setShared(d.shared);
    setOverrides(d.overrides);
    setColorway(d.colorway);
    setFormat(d.format);
    setInkChoice(d.ink);
    setCurtain(d.curtain);
    setSelected(null);
    setScope("all");
    void attachArtwork(d.shared, d.overrides);
  };

  const openLibrary = useCallback(async (fresh: boolean) => {
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
      // A design restored before the folder was connected has stickers waiting
      // on exactly this moment.
      void attachArtwork(shared, overrides);
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
  }, []);

  const addSticker = async (item: LibraryItem) => {
      try {
        const img = await loadFromLibrary(item.name);
        setAssets((prev) => (prev ? { ...prev, stickers: { ...prev.stickers, [item.name]: img } } : prev));
        const id = `${item.name}-${Date.now().toString(36)}`;
        set("stickers", [
          ...content.stickers,
          { id, name: item.name, x: 0.5, y: 0.5, scale: 0.24, rotation: 0 },
        ]);
        setSelected(id);
    } catch (e) {
      setLibError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateSticker = (id: string, patch: Partial<Sticker>) =>
    set(
      "stickers",
      content.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );

  const dragSticker = (id: string, x: number, y: number) => updateSticker(id, { x, y });

  const setTransform = (id: string, patch: Partial<{ x: number; y: number; scale: number; rotation: number }>) =>
    set("transforms", { ...content.transforms, [id]: { ...content.transforms[id], ...patch } });

  const nudge = (id: string, x: number, y: number) => setTransform(id, { x, y });

  const clearTransform = (id: string) => {
    const next = { ...content.transforms };
    delete next[id];
    set("transforms", next);
  };

  /* Put everything back to what the layout would do for this format. The layout
     is the default arrangement now rather than the only one, so this is how you
     get it back after moving things around. */
  const autoArrange = () => set("transforms", {});

  const setElementInk = (id: string, mode: InkMode | null) => {
    const next = { ...content.inkOverrides };
    if (mode) next[id] = mode;
    else delete next[id];
    set("inkOverrides", next);
  };

  const removeSticker = (id: string) => {
    set(
      "stickers",
      content.stickers.filter((s) => s.id !== id),
    );
    setSelected(null);
  };

  const currentDesign = () => ({
    updated: Date.now(),
    shared,
    overrides,
    colorway: colorway.key,
    format: format.key,
    ink,
    curtain,
  });

  const doSave = async () => {
    const name = designName.trim() || content.headline.trim().slice(0, 60) || "Untitled";
    await saveDesign(name, currentDesign());
    setDesigns(await listDesigns());
    setDesignName("");
    setSaveNote(`Saved "${name}"`);
    window.setTimeout(() => setSaveNote(null), 2500);
  };

  const doLoad = async (id: string) => {
    applyDesign(hydrate(await loadDesign(id), DEFAULT_CONTENT));
  };

  const savePresetNow = async () => {
    const name = presetName.trim() || `${format.label} arrangement`;
    await savePreset(name, {
      updated: Date.now(),
      transforms: content.transforms,
      inkOverrides: content.inkOverrides,
      stickers: content.stickers,
      buzz: content.buzz,
      colorway: colorway.key,
      ink,
      curtain,
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
       a saved design. Everything here goes through set(), so the scope toggle
       still decides whether it lands on this format or all of them. */
    set("transforms", pr.transforms);
    set("inkOverrides", pr.inkOverrides);
    set("stickers", pr.stickers);
    set("buzz", pr.buzz);
    setColorway(COLORWAYS.find((c) => c.key === pr.colorway) ?? colorway);
    setInkChoice(pr.ink);
    setCurtain(pr.curtain);
    setSelected(null);
    if (assets) void attachArtwork({ ...shared, stickers: pr.stickers }, overrides);
  };

  const removePreset = async (id: string) => {
    await deletePreset(id);
    setPresets(await listPresets());
  };

  const doDelete = async (id: string) => {
    await deleteDesign(id);
    setDesigns(await listDesigns());
  };

  const missingArt =
    assets === null ? [] : artworkNames(shared, overrides).filter((n) => !assets.stickers[n]);

  const active = content.stickers.find((s) => s.id === selected) ?? null;
  const LABELS: Record<string, string> = {
    headline: "Headline",
    body: "Supporting line",
    cta: "Call to action",
    buzz: "BUZZ",
    wordmark: "Wordmark",
  };
  const selectedLabel = selected ? (LABELS[selected] ?? active?.name ?? "Selected") : "";

  /* What can carry ink at all. Text never boils - that is the rule, not a
     default - so offering a toggle on the headline would be offering a control
     that cannot do anything. The wordmark is out too: the bible forbids
     re-effecting it, and a misregistered edge is an effect on custom artwork. */
  const canInk = (id: string) => !["headline", "body"].includes(id);

  /* Which elements have a size worth adjusting. Text is absent: its size comes
     from fitting it to its zone, so a multiplier fights the autofit. */
  const setScale = (id: string, v: number) => setTransform(id, { scale: v });

  /* Writing in "all formats" scope also CLEARS that field's overrides
   * everywhere. Leaving them would mean "all formats" quietly did not mean all
   * formats - which is the exact silent divergence the markers exist to
   * prevent, so it cannot be built into the write path. Re-overriding is one
   * switch away; a change that appeared to apply and did not is not
   * recoverable, because you never see it. */
  const set = <K extends keyof SocialAdContent>(k: K, v: SocialAdContent[K]) => {
    if (scope === "all") {
      setShared((c) => ({ ...c, [k]: v }));
      setOverrides((o) => {
        const next: Record<string, Partial<SocialAdContent>> = {};
        for (const [key, patch] of Object.entries(o)) {
          const { [k]: _drop, ...rest } = patch;
          if (Object.keys(rest).length) next[key] = rest;
        }
        return next;
      });
    } else {
      setOverrides((o) => ({ ...o, [format.key]: { ...(o[format.key] ?? {}), [k]: v } }));
    }
  };

  /** Drop one field's override for the current format, back to the shared value. */
  const clearField = (k: keyof SocialAdContent) =>
    setOverrides((o) => {
      const { [k]: _drop, ...rest } = o[format.key] ?? {};
      const next = { ...o };
      if (Object.keys(rest).length) next[format.key] = rest;
      else delete next[format.key];
      return next;
    });

  const resetFormat = () =>
    setOverrides((o) => {
      const next = { ...o };
      delete next[format.key];
      return next;
    });

  if (error) return <div className="boot-msg">Could not load brand assets: {error}</div>;
  if (!assets) return <div className="boot-msg">Loading brand assets&hellip;</div>;

  return (
    <div className="studio">
      <aside className="panel">
        <h1>Social ad</h1>
        <p className="sub">Pick a format. Switch any time.</p>

        <h2>Content</h2>
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
            onChange={(e) => set("headline", e.target.value)}
          />
        </Field>
        <Field label="Supporting line" name="body" overridden={overridden} onClear={clearField}>
          <textarea rows={3} value={content.body} onChange={(e) => set("body", e.target.value)} />
        </Field>
        <Field label="Call to action" name="cta" overridden={overridden} onClear={clearField}>
          <input value={content.cta} onChange={(e) => set("cta", e.target.value)} />
        </Field>
        <Field label="BUZZ" name="buzz" overridden={overridden} onClear={clearField}>
          <select value={content.buzz} onChange={(e) => set("buzz", e.target.value as BuzzPose)}>
            {BUZZ_POSES.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <h2>Color</h2>
        <div className="swatches">
          {COLORWAYS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              aria-label={c.label}
              aria-pressed={c.key === colorway.key}
              className={c.key === colorway.key ? "sw on" : "sw"}
              onClick={() => setColorway(c)}
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

        <h2>Ink</h2>
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
              className={ink === key ? "mode on" : "mode"}
              onClick={() => setInkChoice(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          Same three states as the line in the CRM. <strong>Still is not the boil off</strong>
          &mdash; it is one phase of it held, which is what a PNG should carry. It holds the middle
          drawing, so a still and the first frame of its MP4 are the same picture.
        </p>

        <h2>Motion</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={animate}
            onChange={(e) => setAnimate(e.target.checked)}
            disabled={ink !== "live"}
          />
          <span>Animate previews</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={curtain}
            onChange={(e) => setCurtain(e.target.checked)}
          />
          <span>Curtain wipe</span>
        </label>
        <p className="hint">
          Text never boils and BUZZ never warps &mdash; he gets a misregistered silhouette instead.
          Every element can override this; tap one on the artboard. MP4 is {LOOP_FRAMES / FPS}s at{" "}
          {FPS}fps, looping, and the wipe only exists there.
        </p>

        <h2>Artwork</h2>
        {!LIBRARY_SUPPORTED ? (
          <p className="hint">
            Reading a folder needs desktop Chrome or Edge &mdash; no mobile browser supports it,
            so artwork is a desktop-only part of this tool. Everything else works here.
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
              read until you ask for it, and nothing at all is read on page load. Edit a file and
              save &mdash; the tool sees the new version, because it holds a pointer to the folder
              rather than a copy of it.
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
                    onClick={() => addSticker(item)}
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
            {missingArt.length} piece{missingArt.length > 1 ? "s" : ""} of artwork in this design
            {folder ? " could not be found in this folder" : " need the folder connected"}. Their
            place is kept either way.
          </p>
        )}

        {selected && (
          <>
            <h2>{selectedLabel}</h2>
            <label>
              Size
              <input
                type="range"
                min={selected === "wordmark" ? minMarkScale(format) * 100 : 20}
                max={250}
                value={Math.round((active?.scale ?? content.transforms[selected]?.scale ?? 1) * 100)}
                onChange={(e) =>
                  active
                    ? updateSticker(active.id, { scale: Number(e.target.value) / 100 })
                    : setScale(selected, Number(e.target.value) / 100)
                }
              />
              {selected === "wordmark" && (
                <em className="floor">
                  Stops at {Math.round(minMarkScale(format) * 100)}% &mdash; below that the arrow-I
                  signpost stops reading.
                </em>
              )}
            </label>
            <label>
              Rotation
              <input
                type="range"
                min={-180}
                max={180}
                value={active?.rotation ?? content.transforms[selected]?.rotation ?? 0}
                onChange={(e) =>
                  active
                    ? updateSticker(active.id, { rotation: Number(e.target.value) })
                    : setTransform(selected, { rotation: Number(e.target.value) })
                }
              />
            </label>

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
                        (content.inkOverrides[selected] ?? null) === mode ? "mode on" : "mode"
                      }
                      onClick={() => setElementInk(selected, mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="hint">Ink for this element. Default follows the setting above.</p>
              </>
            )}

            <div className="row">
              {!active && content.transforms[selected] && (
                <button type="button" className="ghost" onClick={() => clearTransform(selected)}>
                  Back to auto
                </button>
              )}
              {active && (
                <button type="button" className="ghost" onClick={() => removeSticker(active.id)}>
                  Remove
                </button>
              )}
            </div>
          </>
        )}

        <h2>Format</h2>
        <div className="formats">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={f.key === format.key ? "fmt on" : "fmt"}
              onClick={() => setFormat(f)}
            >
              <strong>
                {f.label}
                {overrides[f.key] && <i className="dot" title="Has its own changes" />}
              </strong>
              <span>{f.where}</span>
              <em>
                {f.w} &times; {f.h}
              </em>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="ghost" onClick={autoArrange}>
            Auto-arrange
          </button>
        </div>
        <p className="hint">
          Everything can be dragged, resized and rotated. Auto-arrange puts it all back to what the
          layout would do for this format.
        </p>
        {overrides[format.key] ? (
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
        <h2>Presets</h2>
        <p className="hint">
          An arrangement and a look, without the words &mdash; the layout, sizes, ink, stickers and
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

        <h2>Designs</h2>
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
      </aside>

      <main className="stage">
        {/* One artboard. The stage still takes a list, which is the seam a
            carousel view would arrive through - several slides of one format,
            side by side. */}
        <div className="solo">
          <Preview
            key={format.key}
            size={format}
            colorway={colorway}
            content={content}
            assets={assets}
            animate={animate && ink === "live"}
            curtain={curtain}
            ink={ink}
            onNudge={nudge}
            onDragSticker={dragSticker}
            onSelect={setSelected}
          />
        </div>
      </main>
    </div>
  );
}
