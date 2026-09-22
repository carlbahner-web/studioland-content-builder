/* The listing builder.
 *
 * One template, four controls, a preview you can drag things around on, and a
 * PNG at the end. It is deliberately NOT the layer editor next door: there is no
 * layer list, no format picker, no undo stack, because the job here is to change
 * an address and a photo on a graphic that is already designed, and every
 * control that is not one of those is a thing to get wrong.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../assets.ts";
import { canSaveFile, saveFile } from "../save.ts";
import {
  BADGES,
  CANVAS,
  HEADSHOTS,
  INK,
  OUTLINE,
  PHOTO_BAND,
  clampBox,
  clampPhotoFit,
  containZoom,
  hits,
  layoutText,
  textBounds,
} from "./template.ts";
import type { PhotoFit, TextAlign, TextBlock } from "./template.ts";
import { addressBlock, emptyDoc, newBlock } from "./doc.ts";
import type { Doc, Photo } from "./doc.ts";
import { LAYER_BOXES, drawDoc, measurer, renderFull } from "./draw.ts";
import type { Art, LayerName } from "./draw.ts";
import "./listing.css";

/** The preview is drawn at this width and CSS-scaled; big enough that the type
 *  antialiases the way it will in the export, small enough to repaint at 60fps. */
const PREVIEW_W = 540;
const PREVIEW_SCALE = PREVIEW_W / CANVAS.w;

function useArt(): { art: Art; ready: boolean; failed: string[] } {
  const [art, setArt] = useState<Art>({});
  const [failed, setFailed] = useState<string[]>([]);
  const names = Object.keys(LAYER_BOXES) as LayerName[];

  useEffect(() => {
    let live = true;
    const loaded: Art = {};
    const bad: string[] = [];
    Promise.all(
      names.map(
        (name) =>
          new Promise<void>((done) => {
            const img = new Image();
            img.onload = () => {
              loaded[name] = img;
              done();
            };
            img.onerror = () => {
              bad.push(name);
              done();
            };
            img.src = assetUrl(`/listing/${name}.png`);
          }),
      ),
    ).then(() => {
      if (!live) return;
      setArt(loaded);
      setFailed(bad);
    });
    return () => {
      live = false;
    };
    // The layer set is a build-time constant; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { art, ready: Object.keys(art).length > 0 || failed.length > 0, failed };
}

/* The webfont has to be IN before the first paint that measures it, or every
 * block is laid out against the fallback and then never re-laid out. `document.
 * fonts.load` is the only thing that actually waits for it - `ready` resolves
 * against fonts already requested, and a font nothing has rendered yet has not
 * been requested. */
function useFontReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (!document.fonts?.load) {
      done();
      return;
    }
    document.fonts.load('16px "TAYWingman"').then(done, done);
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

type Drag =
  | { kind: "photo"; startX: number; startY: number; fromX: number; fromY: number }
  | { kind: "block"; id: string; startX: number; startY: number; fromX: number; fromY: number };

/** `standalone` is the one-file build, where there is no other tool to link to. */
export default function ListingBuilder({ standalone = false }: { standalone?: boolean }) {
  const [doc, setDoc] = useState<Doc>(emptyDoc);
  const [selected, setSelected] = useState<string | null>("address");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { art, ready, failed } = useArt();
  const fontReady = useFontReady();
  const [canSave, setCanSave] = useState(true);

  /* Asked once, and never during the first synchronous run: the download
   * capability is resolved asynchronously by the viewer and is documented never
   * to arrive before then. Optimistic until it answers, so the button is not
   * disabled on a page that can in fact save. */
  useEffect(() => {
    let live = true;
    canSaveFile().then((ok) => live && setCanSave(ok));
    return () => {
      live = false;
    };
  }, []);

  const block = doc.blocks.find((b) => b.id === selected) ?? null;

  /* -------------------------------------------------------------- the photo */

  const onPickPhoto = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNote(`${file.name} is not an image.`);
      return;
    }
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      photoRef.current = img;
      setDoc((d) => {
        if (d.photo) URL.revokeObjectURL(d.photo.src);
        return {
          ...d,
          photo: {
            src,
            name: file.name,
            w: img.naturalWidth,
            h: img.naturalHeight,
            fit: { zoom: 1, offsetX: 0, offsetY: 0 },
          },
        };
      });
      setNote(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      setNote(`Could not read ${file.name}.`);
    };
    img.src = src;
  }, []);

  /* Every photo control goes through here, so the clamp cannot be forgotten by
   * one of them. Passing a function rather than a value lets the slider and the
   * drag both work from the CURRENT fit without closing over a stale one. */
  const setFit = useCallback((change: (fit: PhotoFit, photo: Photo) => PhotoFit) => {
    setDoc((d) => {
      if (!d.photo) return d;
      const next = change(d.photo.fit, d.photo);
      return {
        ...d,
        photo: { ...d.photo, fit: clampPhotoFit(d.photo.w, d.photo.h, PHOTO_BAND, next) },
      };
    });
  }, []);

  const clearPhoto = useCallback(() => {
    photoRef.current = null;
    setDoc((d) => {
      if (d.photo) URL.revokeObjectURL(d.photo.src);
      return { ...d, photo: null };
    });
  }, []);

  // A photo is an object URL; it has to be released when the tool goes away.
  useEffect(
    () => () => {
      const url = photoRef.current?.src;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [],
  );

  /* ---------------------------------------------------------------- drawing */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(PREVIEW_W * dpr);
    const h = Math.round(PREVIEW_W * (CANVAS.h / CANVAS.w) * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawDoc(ctx, doc, art, photoRef.current, { scale: PREVIEW_SCALE * dpr });

    // The selection ring is preview furniture, drawn after and never exported.
    if (block) {
      const measure = measurer(ctx);
      ctx.save();
      ctx.scale(PREVIEW_SCALE * dpr, PREVIEW_SCALE * dpr);
      const bounds = textBounds(block, layoutText(block, measure), measure);
      ctx.strokeStyle = "#7de3ff";
      ctx.lineWidth = 2 / PREVIEW_SCALE;
      ctx.setLineDash([10 / PREVIEW_SCALE, 8 / PREVIEW_SCALE]);
      ctx.strokeRect(bounds.x - 8, bounds.y - 8, bounds.w + 16, bounds.h + 16);
      ctx.restore();
    }
    // fontReady is not read here, but a repaint after the font lands is the
    // whole point of tracking it: the first paint measures the fallback.
  }, [doc, art, block, fontReady]);

  /* -------------------------------------------------------------- dragging */

  const toArtboard = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS.w,
      y: ((e.clientY - r.top) / r.height) * CANVAS.h,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toArtboard(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const measure = measurer(ctx);

    // Topmost first, so a block sitting over another one wins the click.
    for (const b of [...doc.blocks].reverse()) {
      const bounds = textBounds(b, layoutText(b, measure), measure);
      if (!hits(bounds, x, y)) continue;
      setSelected(b.id);
      dragRef.current = { kind: "block", id: b.id, startX: x, startY: y, fromX: b.box.x, fromY: b.box.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (doc.photo && y <= PHOTO_BAND.h) {
      dragRef.current = {
        kind: "photo",
        startX: x,
        startY: y,
        fromX: doc.photo.fit.offsetX,
        fromY: doc.photo.fit.offsetY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    setSelected(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = toArtboard(e);
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (drag.kind === "photo") {
      setFit((fit) => ({ ...fit, offsetX: drag.fromX + dx, offsetY: drag.fromY + dy }));
    } else {
      setDoc((d) => ({
        ...d,
        blocks: d.blocks.map((b) =>
          b.id === drag.id
            ? { ...b, box: clampBox({ ...b.box, x: drag.fromX + dx, y: drag.fromY + dy }) }
            : b,
        ),
      }));
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /* -------------------------------------------------------------- the edits */

  const patch = (id: string, change: Partial<TextBlock>) =>
    setDoc((d) => ({
      ...d,
      blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...change } : b)),
    }));

  const addBlock = () => {
    const b = newBlock();
    setDoc((d) => ({ ...d, blocks: [...d.blocks, b] }));
    setSelected(b.id);
  };

  const removeBlock = (id: string) => {
    // The address is the template, not a block someone added; it resets instead
    // of disappearing, so there is no way to end up with a graphic that has no
    // way to contact anybody.
    if (id === "address") {
      patch(id, addressBlock());
      return;
    }
    setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }));
    setSelected(null);
  };

  /* ---------------------------------------------------------------- the PNG */

  const filename = useMemo(() => {
    const first = doc.blocks.find((b) => b.id === "address")?.text.split("\n")[0] ?? "listing";
    const slug = first.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${slug || "listing"}-${doc.badge === "none" ? "listing" : doc.badge}.png`;
  }, [doc.blocks, doc.badge]);

  const download = async () => {
    setBusy(true);
    setNote(null);
    try {
      const canvas = renderFull(doc, art, photoRef.current);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("the canvas would not encode");
      const outcome = await saveFile(filename, blob);
      if (outcome === "declined") setNote("Save cancelled.");
      else if (outcome === "browser" && !canSave) {
        setNote(`This viewer will not let the page save files. Open it in its own tab to get ${filename}.`);
      } else setNote(`Saved ${filename}`);
    } catch (err) {
      setNote(`Could not export: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------------- view */

  return (
    <div className="listing">
      <header className="listing-head">
        <h1>Listing builder</h1>
        {standalone ? (
          <span className="listing-elsewhere listing-static">StudioLand</span>
        ) : (
          <a href="#/" className="listing-elsewhere">
            Brand content builder →
          </a>
        )}
      </header>

      <div className="listing-body">
        <div
          className={`listing-stage${dropping ? " listing-dropping" : ""}`}
          onDragOver={(e) => {
            // Without preventDefault on BOTH dragover and drop, the browser
            // navigates to the dropped file and the tool is simply gone.
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            onPickPhoto(e.dataTransfer.files?.[0]);
          }}
        >
          <canvas
            ref={canvasRef}
            className="listing-canvas"
            style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <p className="listing-hint">
            {doc.photo
              ? "Drag the photo to place it, Scale to resize it. Drag any text to move it."
              : "Drop a photo of the house here, or choose one on the right."}
          </p>
        </div>

        <div className="listing-panel">
          {failed.length > 0 && (
            <p className="listing-warn">
              Missing artwork: {failed.join(", ")}. Run <code>node scripts/chroma-key.mjs</code>.
            </p>
          )}

          <section>
            <h2>Photo of the house</h2>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="listing-file"
              onChange={(e) => {
                onPickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="listing-row">
              <button type="button" onClick={() => fileRef.current?.click()}>
                {doc.photo ? "Replace photo" : "Choose photo"}
              </button>
              {doc.photo && (
                <button type="button" className="listing-quiet" onClick={clearPhoto}>
                  Remove
                </button>
              )}
            </div>
            {doc.photo && (
              <>
                <p className="listing-filename">
                  {doc.photo.name} · {doc.photo.w}×{doc.photo.h}
                </p>
                <label className="listing-slider">
                  Scale
                  <input
                    type="range"
                    min={containZoom(doc.photo.w, doc.photo.h, PHOTO_BAND)}
                    max={4}
                    step={0.005}
                    value={doc.photo.fit.zoom}
                    onChange={(e) => {
                      const zoom = Number(e.target.value);
                      setFit((fit) => ({ ...fit, zoom }));
                    }}
                  />
                  <span className="listing-readout">{Math.round(doc.photo.fit.zoom * 100)}%</span>
                </label>
                <div className="listing-row">
                  <button
                    type="button"
                    className="listing-quiet"
                    onClick={() => setFit(() => ({ zoom: 1, offsetX: 0, offsetY: 0 }))}
                  >
                    Fill the band
                  </button>
                  <button
                    type="button"
                    className="listing-quiet"
                    onClick={() =>
                      setFit((_fit, photo) => ({
                        zoom: containZoom(photo.w, photo.h, PHOTO_BAND),
                        offsetX: 0,
                        offsetY: 0,
                      }))
                    }
                  >
                    Whole photo
                  </button>
                </div>
              </>
            )}
          </section>

          <section>
            <h2>Headshot</h2>
            <div className="listing-choices">
              {HEADSHOTS.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  aria-pressed={doc.headshot === h.key}
                  className={doc.headshot === h.key ? "listing-on" : ""}
                  onClick={() => setDoc((d) => ({ ...d, headshot: h.key }))}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Badge</h2>
            <div className="listing-choices">
              {BADGES.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={doc.badge === b.key}
                  className={doc.badge === b.key ? "listing-on" : ""}
                  onClick={() => setDoc((d) => ({ ...d, badge: b.key }))}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="listing-row listing-spread">
              <h2>Text</h2>
              <button type="button" className="listing-quiet" onClick={addBlock}>
                + Add text
              </button>
            </div>
            <div className="listing-choices">
              {doc.blocks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={selected === b.id}
                  className={selected === b.id ? "listing-on" : ""}
                  onClick={() => setSelected(b.id)}
                >
                  {b.id === "address" ? "Address" : b.text.split("\n")[0].slice(0, 16) || "Text"}
                </button>
              ))}
            </div>

            {block && (
              <div className="listing-block">
                <textarea
                  value={block.text}
                  rows={block.id === "address" ? 8 : 3}
                  spellCheck={false}
                  onChange={(e) => patch(block.id, { text: e.target.value })}
                />
                <label className="listing-slider">
                  Size
                  <input
                    type="range"
                    min={16}
                    max={180}
                    step={0.5}
                    value={block.size}
                    onChange={(e) => patch(block.id, { size: Number(e.target.value) })}
                  />
                </label>
                <div className="listing-choices">
                  {(["left", "center", "right"] as TextAlign[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={block.align === a}
                      className={block.align === a ? "listing-on" : ""}
                      onClick={() => patch(block.id, { align: a })}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="listing-row">
                  <label className="listing-swatch">
                    Fill
                    <input
                      type="color"
                      value={block.fill}
                      onChange={(e) => patch(block.id, { fill: e.target.value })}
                    />
                  </label>
                  <label className="listing-swatch">
                    Outline
                    <input
                      type="color"
                      value={block.outline ?? OUTLINE}
                      onChange={(e) => patch(block.id, { outline: e.target.value })}
                    />
                  </label>
                  <label className="listing-check">
                    <input
                      type="checkbox"
                      checked={block.outline !== null}
                      onChange={(e) => patch(block.id, { outline: e.target.checked ? OUTLINE : null })}
                    />
                    Outlined
                  </label>
                </div>
                <div className="listing-row">
                  <button
                    type="button"
                    className="listing-quiet"
                    onClick={() => patch(block.id, { fill: INK, outline: OUTLINE })}
                  >
                    Brand colours
                  </button>
                  <button
                    type="button"
                    className="listing-quiet"
                    onClick={() => removeBlock(block.id)}
                  >
                    {block.id === "address" ? "Reset address" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <button
              type="button"
              className="listing-go"
              onClick={download}
              disabled={busy || !ready}
            >
              {busy ? "Exporting…" : `Download ${CANVAS.w}×${CANVAS.h} PNG`}
            </button>
            {note && <p className="listing-note">{note}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
