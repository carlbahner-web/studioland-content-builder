/* The reel title builder.
 *
 * One text box and a download button. Type the title; the tool breaks it into
 * lines, sizes it to the space, sets it on the peony banner at the banner's
 * angle and below Instagram's buttons, and hands back a transparent PNG the
 * size of the reel. There is nothing to position because there is nothing that
 * could usefully be anywhere else.
 *
 * The two things on the panel that are not the title only affect the preview:
 * a still from the video to judge it against, and where Instagram's buttons
 * will sit. Neither is in the export.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../assets.ts";
import { canSaveFile, saveFile } from "../save.ts";
import { CANVAS, SAFE_TOP, SEED, bannerLowest, filenameFor, layoutTitle } from "./template.ts";
import { drawTitle, makePaper, renderFull, titleMeasurer } from "./draw.ts";
import "../listing/listing.css";
import "./title.css";

/* See ListingBuilder: iOS will not reliably save a blob download, so on a
 * touch device the finished PNG is shown full size to press and hold. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** Preview width in CSS px. The canvas behind it is drawn at device resolution. */
const PREVIEW_W = 360;
const PREVIEW_SCALE = PREVIEW_W / CANVAS.w;

/* The frame art the paper is cut from, and the font, both loaded before the
 * first real paint - a title laid out against the fallback face is laid out
 * wrong and would stay wrong until the next keystroke. */
function useArt(): { paper: HTMLCanvasElement | null; ready: boolean; failed: boolean } {
  const [state, setState] = useState<{ paper: HTMLCanvasElement | null; ready: boolean; failed: boolean }>({
    paper: null,
    ready: false,
    failed: false,
  });
  useEffect(() => {
    let live = true;
    const img = new Image();
    const font = document.fonts?.load ? document.fonts.load('16px "TAYWingman"').catch(() => null) : null;
    const art = new Promise<HTMLImageElement | null>((done) => {
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = assetUrl("/listing/frame.png");
    });
    Promise.all([art, font]).then(([frame]) => {
      if (!live) return;
      setState({ paper: makePaper(frame ?? undefined), ready: true, failed: !frame });
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** `standalone` is the one-file build, where there is no other tool to link to. */
export default function TitleBuilder({ standalone = false }: { standalone?: boolean }) {
  const [text, setText] = useState(SEED);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [showUi, setShowUi] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { paper, ready, failed } = useArt();

  useEffect(() => {
    let live = true;
    canSaveFile().then((ok) => live && setCanSave(ok));
    return () => {
      live = false;
    };
  }, []);

  /* One measuring context for the life of the tool: it only ever measures, and
   * its cache is what keeps trying every line break cheap per keystroke. It is
   * rebuilt once the font lands, because widths cached against the fallback
   * face are wrong. */
  const measure = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    return ctx ? titleMeasurer(ctx) : () => 0;
    // `ready` is the font arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const layout = useMemo(() => layoutTitle(text, measure), [text, measure]);
  const coverage = Math.round((bannerLowest(layout) / CANVAS.h) * 100);

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
    drawTitle(ctx, layout, paper, { scale: PREVIEW_SCALE * dpr });
  }, [layout, paper]);

  // The backdrop is an object URL, and has to be released when replaced.
  useEffect(() => () => {
    if (backdrop) URL.revokeObjectURL(backdrop);
  }, [backdrop]);

  const filename = filenameFor(text);

  const download = async () => {
    setBusy(true);
    setNote(null);
    try {
      const canvas = renderFull(text, measure, paper);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("the canvas would not encode");
      const outcome = await saveFile(filename, blob);
      if (outcome === "browser" && COARSE) setHeld(canvas.toDataURL("image/png"));
      else if (outcome === "declined") setNote("Save cancelled.");
      else if (outcome === "browser" && !canSave) {
        setNote(`This viewer will not let the page save files. Open it in its own tab to get ${filename}.`);
      } else setNote(`Saved ${filename}`);
    } catch (err) {
      setNote(`Could not export: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const empty = !layout.lines.length;

  return (
    <div className="listing">
      {held && (
        <div className="held">
          <img src={held} alt="The finished reel title" />
          <p>
            Press and hold the image to save it. It is see-through everywhere but the banner, so it
            shows as a tall picture with the title at the top.
          </p>
          <button type="button" className="ghost" onClick={() => setHeld(null)}>
            Done
          </button>
        </div>
      )}
      <header className="listing-head">
        <h1>ANGELA RERA - REEL TITLE BUILDER</h1>
        {!standalone && (
          <a href="#/listing" className="listing-elsewhere">
            Listing post builder →
          </a>
        )}
      </header>

      <div className="listing-body">
        <div className="listing-stage">
          <div className={`title-phone${backdrop ? "" : " title-checker"}`}>
            {backdrop && <img className="title-backdrop" src={backdrop} alt="" />}
            <canvas ref={canvasRef} className="title-canvas" />
            {showUi && (
              <div className="title-ui" style={{ height: `${(SAFE_TOP / CANVAS.h) * 100}%` }} aria-hidden>
                <span>‹</span>
                <span>◎</span>
              </div>
            )}
          </div>
        </div>

        <div className="listing-panel">
          {failed && (
            <p className="listing-warn">
              The peony paper did not load, so the banner is plain navy. The title is still right.
            </p>
          )}

          <section>
            <h2>Title</h2>
            <div className="listing-block">
              <textarea
                id="title-text"
                value={text}
                rows={3}
                spellCheck
                placeholder="Type the title"
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <p className="title-hint">
              {empty
                ? "Type a title and it will be set on the banner."
                : layout.manual
                  ? `${layout.lines.length} ${layout.lines.length === 1 ? "line" : "lines"}, where you pressed Enter. Take the line breaks out to let it choose.`
                  : `Split into ${layout.lines.length} ${layout.lines.length === 1 ? "line" : "lines"} automatically. Press Enter in the text to choose your own.`}
            </p>
            {!empty && (
              <p className="title-hint">
                Type at {Math.round(layout.size)}px · banner covers the top {coverage}% of the video
                {coverage > 34 ? ", which is a lot - a shorter title will sit smaller" : ""}.
              </p>
            )}
          </section>

          <section>
            <h2>Preview only</h2>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="listing-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && f.type.startsWith("image/")) setBackdrop(URL.createObjectURL(f));
              }}
            />
            <div className="listing-row">
              <button type="button" onClick={() => fileRef.current?.click()}>
                {backdrop ? "Change the still" : "Try it over a still"}
              </button>
              {backdrop && (
                <button type="button" className="listing-quiet" onClick={() => setBackdrop(null)}>
                  Remove
                </button>
              )}
            </div>
            <label className="title-check">
              <input type="checkbox" checked={showUi} onChange={(e) => setShowUi(e.target.checked)} />
              Show where Instagram's buttons sit
            </label>
            <p className="title-hint">Neither of these is in the download.</p>
          </section>

          <section>
            <button
              type="button"
              className="listing-go"
              onClick={download}
              disabled={busy || !ready || empty}
            >
              {busy ? "Exporting…" : `Download ${CANVAS.w}×${CANVAS.h} transparent PNG`}
            </button>
            {note && <p className="listing-note">{note}</p>}
            <p className="title-hint">
              The PNG is the same size as a reel. Lay it over the whole video - it lines up by
              itself.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
