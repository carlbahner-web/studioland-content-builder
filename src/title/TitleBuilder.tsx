/* The reel title builder.
 *
 * One text box and a download button. Type the title; the tool breaks it into
 * lines, sizes it to the safe box, centres it there on the peony banner, and
 * hands back a transparent PNG the
 * size of the reel. There is nothing to position because there is nothing that
 * could usefully be anywhere else.
 *
 * The one thing that is not the title is a screenshot of the video to preview
 * the banner over. It is not in the export.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../assets.ts";
import { canSaveFile, saveFile } from "../save.ts";
import { CANVAS, SEED, filenameFor, layoutTitle } from "./template.ts";
import { drawTitle, makePaper, renderFull, titleMeasurer } from "./draw.ts";
import "../listing/listing.css";
import "./title.css";

/* See ListingBuilder: iOS will not reliably save a blob download, so on a
 * touch device the finished PNG is shown full size to press and hold. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** Preview width in CSS px. The canvas behind it is drawn at device resolution. */
const PREVIEW_W = 420;
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

  /* One column, top to bottom, at every width: type it, see it, save it. This
   * is used from a phone, where a side panel would be a second screen to
   * scroll to, and a desk gains nothing from the extra room. */
  return (
    <div className="title">
      {held && (
        <div className="held">
          <img src={held} alt="The finished reel title" />
          <p>Press and hold the image, then tap Save to Photos.</p>
          <button type="button" className="ghost" onClick={() => setHeld(null)}>
            Done
          </button>
        </div>
      )}
      <header className="listing-head">
        <h1>ANGELA RERA - REEL TITLES</h1>
        {!standalone && (
          <a href="#/listing" className="listing-elsewhere">
            Listing posts →
          </a>
        )}
      </header>

      <main className="title-column">
        <label className="title-label" htmlFor="title-text">
          Title
        </label>
        <textarea
          id="title-text"
          className="title-input"
          value={text}
          rows={2}
          spellCheck
          placeholder="Type your title"
          onChange={(e) => setText(e.target.value)}
        />
        <p className="title-hint">Press Enter to start a new line where you want one.</p>

        {/* The top of the frame only: the banner is all there is to see, and the
            rest of a 9:16 preview is a long stretch of nothing on a phone. */}
        <div className={`title-phone${backdrop ? "" : " title-checker"}`}>
          <div className="title-frame">
            {backdrop && <img className="title-backdrop" src={backdrop} alt="" />}
            <canvas ref={canvasRef} className="title-canvas" />
          </div>
        </div>

        <button type="button" className="title-go" onClick={download} disabled={busy || !ready || empty}>
          {busy ? "Saving…" : "Save title image"}
        </button>
        {note && <p className="title-hint">{note}</p>}
        <p className="title-hint">Lay it over the whole video. It lines up by itself.</p>

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
        <button
          type="button"
          className="title-quiet"
          onClick={() => (backdrop ? setBackdrop(null) : fileRef.current?.click())}
        >
          {backdrop ? "Remove the screenshot" : "Preview it over a screenshot of the video"}
        </button>

        {failed && <p className="title-hint">The flower pattern did not load, so the banner is plain navy.</p>}
      </main>
    </div>
  );
}
