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
  BADGE_PRESETS,
  CANVAS,
  HEADSHOTS,
  LAYOUTS,
  PHOTO_BAND,
  PHOTO_FILES,
  clampPhotoFit,
  containZoom,
  zoomAt,
} from "./template.ts";
import type { PhotoFit, Point, TextAlign, TextBlock } from "./template.ts";
import { addressBlock, badgeBlock, emptyDoc, withLayout } from "./doc.ts";
import type { Doc, Photo } from "./doc.ts";
import { LAYER_BOXES, drawDoc, renderFull } from "./draw.ts";
import type { Art } from "./draw.ts";
import { TITLE_ARTIFACT } from "../links.ts";
import "./listing.css";

/* A programmatic download is not reliable everywhere, and this tool is used
 * from a phone more than from a desk.
 *
 * iOS Safari treats `<a download>` on a blob inconsistently - it often opens the
 * image in a new tab instead of saving it - so a tool that reports "Saved" there
 * has told the person something untrue. The gesture that does work is
 * press-and-hold on the image itself, which needs the image on screen at full
 * size. Same fallback the content builder next door uses, and the same `.held`
 * chrome, because it is the same problem.
 *
 * Read once at module load: a pointer does not become coarse mid-session, and
 * re-querying per export would only add a way for the two paths to disagree. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** The preview is drawn at this width and CSS-scaled; big enough that the type
 *  antialiases the way it will in the export, small enough to repaint at 60fps. */
const PREVIEW_W = 540;
const PREVIEW_SCALE = PREVIEW_W / CANVAS.w;

function useArt(): { art: Art; ready: boolean; failed: string[] } {
  const [art, setArt] = useState<Art>({});
  const [failed, setFailed] = useState<string[]>([]);
  /* Keyed layers are named by the manifest and live at /listing/<name>.png; the
     mask and the photographed headshots carry their own paths. Loaded together
     because the artboard is not drawable until all of them are in. */
  const wanted: { id: string; url: string }[] = [
    ...Object.keys(LAYER_BOXES).map((name) => ({ id: name, url: `/listing/${name}.png` })),
    ...PHOTO_FILES.map((file) => ({ id: file, url: file })),
    ...HEADSHOTS.filter((h) => h.photo).map((h) => ({ id: h.key, url: h.photo!.file })),
  ];

  useEffect(() => {
    let live = true;
    const loaded: Art = {};
    const bad: string[] = [];
    Promise.all(
      wanted.map(
        ({ id, url }) =>
          new Promise<void>((done) => {
            const img = new Image();
            img.onload = () => {
              loaded[id] = img;
              done();
            };
            img.onerror = () => {
              bad.push(id);
              done();
            };
            img.src = assetUrl(url);
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

/** `standalone` is the one-file build, which links out to the reel title
 *  artifact rather than to a route. */
export default function ListingBuilder({ standalone = false }: { standalone?: boolean }) {
  const [doc, setDoc] = useState<Doc>(emptyDoc);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  /** The finished PNG, shown full size for press-and-hold. See COARSE. */
  const [held, setHeld] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
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

  /* Two blocks, fixed: the address and the badge. Looked up by id rather than
   * by index, so reordering the draw never silently reassigns a control. */
  const address = doc.blocks.find((b) => b.id === "address") ?? addressBlock();
  const badge = doc.blocks.find((b) => b.id === "badge") ?? badgeBlock();

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

    // fontReady is not read here, but a repaint after the font lands is the
    // whole point of tracking it: the first paint measures the fallback.
  }, [doc, art, fontReady]);

  /* ------------------------------------------------- placing the photo only */

  /* The ONLY thing on this artboard that moves. Text sits in the slots the
   * template defines and cannot be dragged at all - a listing graphic whose
   * contact details have drifted a few pixels from the last one is worse than
   * one that could not be adjusted. The photo is the exception because it is
   * the only element whose content is not known in advance: framing a house is
   * a judgement nobody can make for you. */

  const toArtboard = (e: { clientX: number; clientY: number }, el: HTMLCanvasElement): Point => {
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS.w,
      y: ((e.clientY - r.top) / r.height) * CANVAS.h,
    };
  };

  /* Live pointers, by id. A pinch is simply "two of these", which is why they
   * are tracked rather than handled as a separate gesture mode: a finger lifted
   * mid-pinch then has to degrade to a drag with no seam, and any bookkeeping
   * that is not just "how many are down" gets that wrong. */
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ dist: number; mid: Point } | null>(null);

  const spread = (pts: Point[]) => {
    const [a, b] = pts;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!doc.photo) return;
    const pt = toArtboard(e, e.currentTarget);
    // A one-finger drag starts only on the photo; two fingers may start
    // anywhere, because a pinch is aimed at the picture as a whole and asking
    // someone to land both thumbs inside a band is not a real requirement.
    if (pointers.current.size === 0 && pt.y > PHOTO_BAND.h) return;
    pointers.current.set(e.pointerId, pt);
    e.currentTarget.setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2 ? spread(pts) : null;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    const pt = toArtboard(e, e.currentTarget);
    pointers.current.set(e.pointerId, pt);
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const now = spread(pts.slice(0, 2));
      const was = gesture.current;
      gesture.current = now;
      if (!was || was.dist <= 0) return;
      /* Incremental, frame to frame, rather than measured against where the
       * fingers started. The two are identical until a finger is added or
       * lifted, and then the "since the start" version jumps, because its
       * baseline belongs to a gesture that no longer exists. */
      const k = now.dist / was.dist;
      const panX = now.mid.x - was.mid.x;
      const panY = now.mid.y - was.mid.y;
      setFit((fit) => {
        const zoomed = zoomAt(fit, fit.zoom * k, now.mid, PHOTO_BAND);
        return { ...zoomed, offsetX: zoomed.offsetX + panX, offsetY: zoomed.offsetY + panY };
      });
      return;
    }

    setFit((fit) => ({
      ...fit,
      offsetX: fit.offsetX + (pt.x - prev.x),
      offsetY: fit.offsetY + (pt.y - prev.y),
    }));
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const pts = [...pointers.current.values()];
    gesture.current = pts.length === 2 ? spread(pts) : null;
  };

  /* Trackpad pinch arrives as a wheel event with ctrlKey set - there is no
   * gesture event for it outside Safari - and it has to be preventDefault'd or
   * the browser zooms the whole page instead. React attaches wheel passively at
   * the root, where preventDefault is ignored, so this one is bound by hand.
   * A plain wheel is left alone: that is the person scrolling the page. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const at = toArtboard(e, canvas);
      // deltaY is in the tens for a trackpad pinch; e^(-d/120) is the usual
      // smooth mapping and keeps a fast pinch from overshooting the clamp.
      // setFit clamps, so the zoom cannot run past the ends of its range here.
      setFit((fit) => zoomAt(fit, fit.zoom * Math.exp(-e.deltaY / 120), at, PHOTO_BAND));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------------------- the edits */

  const patchBlock = (id: string, change: Partial<TextBlock>) =>
    setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? { ...b, ...change } : b)) }));

  /* ---------------------------------------------------------------- the PNG */

  const filename = useMemo(() => {
    const first = doc.blocks.find((b) => b.id === "address")?.text.split("\n")[0] ?? "listing";
    const slug = first.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const state = badge.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "listing";
    return `${slug || "listing"}-${state}.png`;
  }, [doc.blocks, badge.text]);

  const download = async () => {
    setBusy(true);
    setNote(null);
    try {
      const canvas = renderFull(doc, art, photoRef.current);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("the canvas would not encode");
      const outcome = await saveFile(filename, blob);
      /* Only fall back where the browser download is the one that ran AND is
       * the unreliable kind. A capability save is confirmed and needs no
       * follow-up, and on a desktop the anchor simply works. */
      if (outcome === "browser" && COARSE) {
        setHeld(canvas.toDataURL("image/png"));
        setNote(null);
      } else if (outcome === "declined") setNote("Save cancelled.");
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
      {held && (
        <div className="held">
          <img src={held} alt="The finished listing post" />
          <p>Press and hold the image to save it to your photos.</p>
          <button type="button" className="ghost" onClick={() => setHeld(null)}>
            Done
          </button>
        </div>
      )}
      <header className="listing-head">
        <h1>ANGELA RERA - LISTING POST BUILDER</h1>
        {/* Her other tool, always. In the one-file build it is the reel title
            artifact's own URL, because there is no router to hand a hash to;
            the brand content builder is only reachable in the routed build. */}
        <nav className="listing-links">
          <a href={standalone ? TITLE_ARTIFACT : "#/title"} className="listing-elsewhere">
            Reel titles →
          </a>
          {!standalone && (
            <a href="#/" className="listing-elsewhere">
              Brand content builder →
            </a>
          )}
        </nav>
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
            className={`listing-canvas${doc.photo ? " listing-grabbable" : ""}`}
            style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          />
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
            <h2>Layout</h2>
            <div className="listing-choices">
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  id={`layout-${l.key}`}
                  type="button"
                  aria-pressed={doc.layout === l.key}
                  className={doc.layout === l.key ? "listing-on" : ""}
                  onClick={() => setDoc((d) => withLayout(d, l.key))}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Headshot</h2>
            <div className="listing-choices">
              {HEADSHOTS.map((h) => (
                <button
                  key={h.key}
                  id={`headshot-${h.key}`}
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
              {BADGE_PRESETS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={badge.text === b.text}
                  className={badge.text === b.text ? "listing-on" : ""}
                  onClick={() => patchBlock("badge", { text: b.text })}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {/* The presets are the common two; this is the same block, so
                anything else - JUST LISTED!, OPEN SUNDAY - goes in the same
                place at the same size, shrinking if it is long. */}
            <input
              id="listing-badge"
              type="text"
              className="listing-text"
              value={badge.text}
              placeholder="or type your own"
              spellCheck={false}
              onChange={(e) => patchBlock("badge", { text: e.target.value })}
            />
          </section>

          <section>
            <h2>Address</h2>
            <div className="listing-block">
              <textarea
                id="listing-address"
                value={address.text}
                rows={8}
                spellCheck={false}
                onChange={(e) => patchBlock("address", { text: e.target.value })}
              />
              <div className="listing-choices">
                {(["left", "center", "right"] as TextAlign[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={address.align === a}
                    className={address.align === a ? "listing-on" : ""}
                    onClick={() => patchBlock("address", { align: a })}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <div className="listing-row">
                <button
                  type="button"
                  className="listing-quiet"
                  onClick={() => setDoc((d) => ({ ...d, blocks: [addressBlock()] }))}
                >
                  Reset address
                </button>
              </div>
            </div>
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
