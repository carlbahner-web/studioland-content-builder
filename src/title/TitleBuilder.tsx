/* The reel title builder.
 *
 * Four steps, one thing to do on each: type the words, check how they look,
 * save the picture, put it on the video. The person using it never positions,
 * sizes or configures anything - the layout engine in template.ts does all of
 * that - so every screen can be a single question with a single big button.
 *
 * Written for a laptop first. The reel is edited in Descript on a Windows
 * laptop, so a title made on the same machine lands in Downloads and goes
 * straight into Descript: no phone, no cable, no moving files between devices.
 * It still works on a phone, where saving falls back to press-and-hold.
 *
 * Words on screen are the person's words, not the tool's: "picture", "save",
 * "Downloads folder" - never PNG, export, transparent or safe zone.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../assets.ts";
import { canSaveFile, saveFile } from "../save.ts";
import {
  BANNER_BOTTOM,
  CANVAS,
  SAFE_BOX,
  filenameFor,
  layoutTitle,
  titleChoices,
} from "./template.ts";
import { drawTitle, makePaper, renderFull, titleMeasurer } from "./draw.ts";
import { LISTING_ARTIFACT } from "../links.ts";
import "../listing/listing.css";
import "./title.css";

/* See ListingBuilder: iOS will not reliably save a blob download, so on a
 * touch device the finished picture is shown full size to press and hold. */
const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/* `?guides` in the address shows the safe box on the preview. For whoever is
 * looking after the tool, not for the person using it, so it is off unless
 * asked for and there is no control for it on the page. */
const GUIDES =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("guides");

/* Kept in the browser so closing the tab by accident loses nothing. Storage can
 * be missing or refuse (private windows, blocked site data), and the page has
 * to work exactly the same without it. */
const DRAFT_KEY = "reel-title-draft";
function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(text: string): void {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* not kept; nothing else changes */
  }
}

/* Below this the type is small enough to be hard to read on a phone. Said
 * kindly and never enforced: it is her title. */
const SMALL_TYPE = 64;

/* How to put the picture on a video in Descript. Kept as plain data so the
 * wording can be corrected without touching the page - Descript changes its
 * screens, and these should match what she actually sees. */
const DESCRIPT_STEPS = [
  "Open your video in Descript.",
  "Open your Downloads folder: hold the Windows key and press E, then click Downloads on the left.",
  "Find the picture called “{name}” and drag it onto your video in Descript.",
  "If it doesn't cover the whole video, drag its corners out to the edges. Only the banner shows; your video stays visible underneath.",
  "Make it last as long as you want the title on screen: in the timeline at the bottom, drag the end of the title picture to where it should stop.",
];

/* Two sizes of preview, both the same drawTitle call as the saved picture, so
 * what she sees is what she gets. */
const BANNER_PREVIEW_W = 560;
const REEL_PREVIEW_W = 150;
const CHOICE_PREVIEW_W = 240;

function paint(
  canvas: HTMLCanvasElement | null,
  cssW: number,
  frameH: number,
  layout: ReturnType<typeof layoutTitle>,
  paper: HTMLCanvasElement | null,
): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = (cssW / CANVAS.w) * dpr;
  const w = Math.round(CANVAS.w * scale);
  const h = Math.round(frameH * scale);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawTitle(ctx, layout, paper, { scale });
}

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

/* The safe box as a dashed outline, over the banner preview when `?guides` is
 * set. HTML over the canvas, so it cannot reach the saved picture. */
function SafeZone({ frameH }: { frameH: number }) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div
      className="title-safe"
      aria-hidden
      style={{
        left: pct(SAFE_BOX.x, CANVAS.w),
        width: pct(SAFE_BOX.w, CANVAS.w),
        top: pct(SAFE_BOX.y, frameH),
        height: pct(SAFE_BOX.h, frameH),
      }}
    />
  );
}

/** One layout choice, drawn small, as a button. */
function Choice(props: {
  lines: string[];
  on: boolean;
  label: string;
  measure: Parameters<typeof layoutTitle>[1];
  paper: HTMLCanvasElement | null;
  onPick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { lines, measure, paper } = props;
  useEffect(() => {
    paint(ref.current, CHOICE_PREVIEW_W, BANNER_BOTTOM, layoutTitle(lines.join("\n"), measure), paper);
  }, [lines, measure, paper]);
  return (
    <button
      type="button"
      className={`tb-choice${props.on ? " tb-choice-on" : ""}`}
      aria-pressed={props.on}
      onClick={props.onPick}
    >
      <canvas ref={ref} style={{ aspectRatio: `${CANVAS.w} / ${BANNER_BOTTOM}` }} aria-hidden />
      <span>{props.on ? "✓ " : ""}{props.label}</span>
    </button>
  );
}

type Step = 1 | 2 | 3 | 4;

/** `standalone` is the one-file build, which links out to the listing builder
 *  artifact rather than to a route. */
export default function TitleBuilder({ standalone = false }: { standalone?: boolean }) {
  const [step, setStep] = useState<Step>(1);
  const [text, setText] = useState(readDraft);
  const [choice, setChoice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The saved picture, shown full size for press-and-hold on a phone. */
  const [held, setHeld] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(true);

  const bannerRef = useRef<HTMLCanvasElement>(null);
  const reelRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { paper, ready, failed } = useArt();

  useEffect(() => {
    let live = true;
    canSaveFile().then((ok) => live && setCanSave(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => writeDraft(text), [text]);

  /* Each new step starts at the top with its heading focused, so a screen
   * reader announces it and a keyboard user starts in the right place. */
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  /* One measuring context for the life of the tool, rebuilt once the font
   * lands, because widths measured against the fallback face are wrong. */
  const measure = useMemo(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    return ctx ? titleMeasurer(ctx) : () => 0;
    // `ready` is the font arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const choices = useMemo(() => titleChoices(text, measure), [text, measure]);
  const picked = choices[Math.min(choice, choices.length - 1)] ?? [];
  // The chosen breaks, as typed breaks: the layout engine keeps those as given.
  const finalText = picked.join("\n");
  const layout = useMemo(() => layoutTitle(finalText, measure), [finalText, measure]);
  const empty = !text.trim();

  useEffect(() => {
    if (step !== 2) return;
    paint(bannerRef.current, BANNER_PREVIEW_W, BANNER_BOTTOM, layout, paper);
    paint(reelRef.current, REEL_PREVIEW_W, CANVAS.h, layout, paper);
  }, [step, layout, paper]);

  const filename = filenameFor(text);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const canvas = renderFull(finalText, measure, paper);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("no picture");
      const outcome = await saveFile(filename, blob);
      if (outcome === "declined") {
        setProblem("It wasn't saved. Press the button again, and choose Save when asked.");
        return;
      }
      if (outcome === "browser" && !canSave) {
        setProblem("This page can't save pictures here. Open it in its own browser tab and try again.");
        return;
      }
      if (outcome === "browser" && COARSE) setHeld(canvas.toDataURL("image/png"));
      setSavedName(filename);
      setStep(3);
    } catch {
      setProblem("Something went wrong making the picture. Please press the button again.");
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setText("");
    setChoice(0);
    setSavedName(null);
    setHeld(null);
    setProblem(null);
    setStep(1);
  };

  const back = (to: Step) => (
    <button type="button" className="tb-back" onClick={() => setStep(to)}>
      ← Back
    </button>
  );

  return (
    <div className="title">
      <header className="listing-head">
        <h1>ANGELA RERA - REEL TITLES</h1>
        {standalone ? (
          <a href={LISTING_ARTIFACT} className="listing-elsewhere">
            Listing posts →
          </a>
        ) : (
          <a href="#/angela" className="listing-elsewhere">
            ← Home
          </a>
        )}
      </header>

      <main className="tb">
        <p className="tb-progress" aria-label={`Step ${step} of 4`}>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={n <= step ? "tb-dot tb-dot-on" : "tb-dot"} aria-hidden />
          ))}
          <span>Step {step} of 4</span>
        </p>

        {step === 1 && (
          <section className="tb-step">
            <h2 ref={headingRef} tabIndex={-1}>
              What should your title say?
            </h2>
            <p className="tb-lead">Type it just the way you'd say it. We'll do the rest.</p>
            <label className="tb-visually-hidden" htmlFor="title-text">
              Your title
            </label>
            <textarea
              id="title-text"
              className="tb-input"
              value={text}
              rows={3}
              spellCheck
              placeholder="For example: Pet owners: to fence or not to fence?"
              onChange={(e) => {
                setText(e.target.value);
                setChoice(0);
              }}
            />
            <button
              type="button"
              className="tb-primary"
              disabled={empty || !ready}
              onClick={() => setStep(2)}
            >
              {ready ? "Next: see how it looks" : "Getting ready…"}
            </button>
            {empty && <p className="tb-hint">Type a few words above, then press the button.</p>}
          </section>
        )}

        {step === 2 && (
          <section className="tb-step">
            {back(1)}
            <h2 ref={headingRef} tabIndex={-1}>
              Here's your title
            </h2>
            <p className="tb-lead">This is the banner that will sit across the top of your video.</p>

            <div className="tb-previews">
              <div className="tb-banner" style={{ aspectRatio: `${CANVAS.w} / ${BANNER_BOTTOM}` }}>
                <canvas ref={bannerRef} className="title-canvas" aria-label={`Your title: ${picked.join(" ")}`} />
                {GUIDES && <SafeZone frameH={BANNER_BOTTOM} />}
              </div>
              <figure className="tb-reel">
                <div className="tb-reel-frame">
                  <span className="tb-reel-video" aria-hidden>
                    Your video
                  </span>
                  <canvas ref={reelRef} className="title-canvas" aria-hidden />
                </div>
                <figcaption>On your video</figcaption>
              </figure>
            </div>

            {layout.size < SMALL_TYPE && (
              <p className="tb-note">
                That's quite a few words, so the letters are small. A shorter title is easier to read
                on a phone, but this one will work too.
              </p>
            )}

            {choices.length > 1 && (
              <div className="tb-choices">
                <p className="tb-choices-q">Want the lines split differently? Tap the one you like best.</p>
                <div className="tb-choice-row">
                  {choices.map((c, i) => (
                    <Choice
                      key={c.join("|")}
                      lines={c}
                      on={i === Math.min(choice, choices.length - 1)}
                      label={`${c.length} ${c.length === 1 ? "line" : "lines"}`}
                      measure={measure}
                      paper={paper}
                      onPick={() => setChoice(i)}
                    />
                  ))}
                </div>
              </div>
            )}

            <button type="button" className="tb-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Looks good — save it"}
            </button>
            <button type="button" className="tb-secondary" onClick={() => setStep(1)}>
              Change the words
            </button>
            {problem && (
              <p className="tb-problem" role="alert">
                {problem}
              </p>
            )}
            {failed && (
              <p className="tb-hint">The flower pattern didn't load, so the banner is plain navy. It still works.</p>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="tb-step">
            {back(2)}
            {held ? (
              <>
                <h2 ref={headingRef} tabIndex={-1}>
                  One more tap to save it
                </h2>
                <p className="tb-lead">
                  Press and hold the picture below, then tap <strong>Save to Photos</strong>.
                </p>
                <img className="tb-held" src={held} alt="Your title picture" />
              </>
            ) : (
              <>
                <h2 ref={headingRef} tabIndex={-1}>
                  ✓ Saved!
                </h2>
                <p className="tb-lead">Your title picture is in your <strong>Downloads</strong> folder. It's called:</p>
                <p className="tb-filename">{savedName}</p>
              </>
            )}
            <button type="button" className="tb-primary" onClick={() => setStep(4)}>
              Next: put it on your video
            </button>
            <button type="button" className="tb-secondary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "It didn't save — try again"}
            </button>
            {problem && (
              <p className="tb-problem" role="alert">
                {problem}
              </p>
            )}
          </section>
        )}

        {step === 4 && (
          <section className="tb-step">
            {back(3)}
            <h2 ref={headingRef} tabIndex={-1}>
              Put it on your video in Descript
            </h2>
            <ol className="tb-howto">
              {DESCRIPT_STEPS.map((s, i) => (
                <li key={i}>{s.replace("{name}", savedName ?? filename)}</li>
              ))}
            </ol>
            <p className="tb-hint">
              The picture is see-through everywhere except the banner, so it can cover the whole
              video without hiding anything.
            </p>
            <button type="button" className="tb-primary" onClick={startOver}>
              Make another title
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
