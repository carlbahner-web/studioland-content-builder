/* The listing post, one step at a time.
 *
 * Which house, the photo, sold or pending, which photo of her, save. Each is
 * one screen with one question, and everything the full editor exposes as a
 * control - alignment, the badge's free text, the zoom slider, the brand's
 * contact lines - is either decided for her or tucked behind a plain question.
 * The post it makes is drawn by the same drawDoc as the full editor
 * (#/listing/advanced), from the same Doc, so the two cannot disagree.
 *
 * Written for a laptop first, where she edits; on a phone saving falls back to
 * press-and-hold, as everywhere else in these tools.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { canSaveFile, saveFile } from "../save.ts";
import { CANVAS, HEADSHOTS, LAYOUTS, PHOTO_BAND, clampPhotoFit, zoomAt } from "./template.ts";
import type { LayoutKey, PhotoFit, Point } from "./template.ts";
import { addressBlock, badgeBlock } from "./doc.ts";
import type { Doc, Photo } from "./doc.ts";
import { drawDoc, renderFull } from "./draw.ts";
import type { Art } from "./draw.ts";
import { useArt, useFontReady } from "./art.ts";
import { LONG_STREET, addressText, listingFilename, readDraft } from "./guide.ts";
import type { Draft } from "./guide.ts";
import "./listing.css";
import "../title/title.css";
import "./guide.css";

const COARSE =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const DRAFT_KEY = "listing-post-draft";
function loadDraft(): Partial<Draft> {
  try {
    return readDraft(localStorage.getItem(DRAFT_KEY));
  } catch {
    return {};
  }
}
function keepDraft(d: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* not kept; nothing else changes */
  }
}

/* How to post it. Plain data, so the wording can follow Instagram's screens
 * without touching the page. "{name}" is the saved file's name. */
const POST_FROM_LAPTOP = [
  "Go to instagram.com in your web browser and sign in.",
  "Click “Create” (the + sign) on the left, then “Post”.",
  "Click “Select from computer”, click Downloads on the left, and choose “{name}”.",
  "If the edges look cut off, click the small button with two arrows at the bottom left and choose “4:5”. Then click Next, and Next again.",
  "Write your caption, then click Share.",
];
const POST_FROM_PHONE = [
  "The easiest way is to make the post on your phone: open this page there, and your finished post saves straight to your Photos.",
  "Open Instagram and tap the + button.",
  "Your post is the newest picture in your Photos. Tap it, then tap Next.",
  "Write your caption, then tap Share.",
];

const BADGES = [
  { key: "none", label: "Just the house", text: "" },
  { key: "sold", label: "SOLD!", text: "SOLD!" },
  { key: "pending", label: "PENDING!", text: "PENDING!" },
];

const STEPS = 5;
type Step = 1 | 2 | 3 | 4 | 5;

function buildDoc(p: {
  photo: Photo | null;
  layout: LayoutKey;
  headshot: string;
  street: string;
  town: string;
  badge: string;
}): Doc {
  return {
    photo: p.photo,
    layout: p.layout,
    headshot: p.headshot,
    blocks: [
      { ...addressBlock(p.layout), text: addressText(p.street, p.town) },
      badgeBlock(p.badge, p.layout),
    ],
  };
}

function paint(
  canvas: HTMLCanvasElement | null,
  cssW: number,
  doc: Doc,
  art: Art,
  photo: HTMLImageElement | null,
): void {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = (cssW / CANVAS.w) * dpr;
  const w = Math.round(CANVAS.w * scale);
  const h = Math.round(CANVAS.h * scale);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawDoc(ctx, doc, art, photo, { scale });
}

/** One choice, drawn as a small copy of the whole post. */
function MiniPost(props: {
  doc: Doc;
  art: Art;
  photo: HTMLImageElement | null;
  on: boolean;
  label: string;
  id?: string;
  onPick: () => void;
  redraw: unknown;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { doc, art, photo, redraw } = props;
  useEffect(() => {
    // Drawn at the width it is shown at, which differs between the grid of
    // headshots and the two wide side-by-side choices.
    paint(ref.current, ref.current?.clientWidth || 150, doc, art, photo);
    // `redraw` is the font landing; the doc's own identity changes on edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, art, photo, redraw]);
  return (
    <button
      id={props.id}
      type="button"
      className={`tb-choice lg-mini${props.on ? " tb-choice-on" : ""}`}
      aria-pressed={props.on}
      onClick={props.onPick}
    >
      <canvas ref={ref} style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }} aria-hidden />
      <span>
        {props.on ? "✓ " : ""}
        {props.label}
      </span>
    </button>
  );
}

/** `onHome` is for the one-file build, which has no router: Home is a state
 *  change there rather than a link to #/angela. */
export default function ListingGuide({ onHome }: { onHome?: () => void }) {
  const draft = useMemo(loadDraft, []);
  const [step, setStep] = useState<Step>(1);
  const [street, setStreet] = useState(draft.street ?? "");
  const [town, setTown] = useState(draft.town ?? "");
  const [badge, setBadge] = useState(draft.badge ?? "");
  const [ownWords, setOwnWords] = useState(() => !!draft.badge && !BADGES.some((b) => b.text === draft.badge));
  const [headshot, setHeadshot] = useState(
    HEADSHOTS.some((h) => h.key === draft.headshot) ? draft.headshot! : HEADSHOTS[0].key,
  );
  const [layout, setLayout] = useState<LayoutKey>(draft.layout === "mirrored" ? "mirrored" : "standard");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [moving, setMoving] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [postFrom, setPostFrom] = useState<"laptop" | "phone">(COARSE ? "phone" : "laptop");
  const [canSave, setCanSave] = useState(true);

  const photoRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { art, ready, failed } = useArt();
  const fontReady = useFontReady();

  useEffect(() => {
    let live = true;
    canSaveFile().then((ok) => live && setCanSave(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => keepDraft({ street, town, badge, headshot, layout }), [street, town, badge, headshot, layout]);

  useEffect(() => {
    window.scrollTo?.({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  const doc = useMemo(
    () => buildDoc({ photo, layout, headshot, street, town, badge }),
    [photo, layout, headshot, street, town, badge],
  );

  useEffect(() => {
    if (step >= 2 && step <= 4) paint(previewRef.current, 520, doc, art, photoRef.current);
  }, [step, doc, art, fontReady]);

  /* ---------------------------------------------------------- the photo */

  const pickPhoto = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProblem("That file isn't a photo. Please choose a photo.");
      return;
    }
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const old = photoRef.current?.src;
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      photoRef.current = img;
      setPhoto({
        src,
        name: file.name,
        w: img.naturalWidth,
        h: img.naturalHeight,
        fit: { zoom: 1, offsetX: 0, offsetY: 0 },
      });
      setProblem(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      setProblem("That photo couldn't be opened. Please choose a different one.");
    };
    img.src = src;
  }, []);

  const setFit = (change: (fit: PhotoFit) => PhotoFit) =>
    setPhoto((p) => (p ? { ...p, fit: clampPhotoFit(p.w, p.h, PHOTO_BAND, change(p.fit)) } : p));

  const centre: Point = { x: PHOTO_BAND.w / 2, y: PHOTO_BAND.h / 2 };
  const zoomBy = (k: number) => setFit((fit) => zoomAt(fit, fit.zoom * k, centre, PHOTO_BAND));

  /* Dragging the photo with a mouse or a finger, on step 2 only. One pointer:
   * pinching is not something to ask for; the bigger and smaller buttons do
   * that job. */
  const drag = useRef<{ id: number; at: Point } | null>(null);
  const toArtboard = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CANVAS.w, y: ((e.clientY - r.top) / r.height) * CANVAS.h };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (step !== 2 || !photo || drag.current) return;
    const at = toArtboard(e);
    if (at.y > PHOTO_BAND.h) return;
    drag.current = { id: e.pointerId, at };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    const at = toArtboard(e);
    const prev = drag.current.at;
    drag.current.at = at;
    setFit((fit) => ({ ...fit, offsetX: fit.offsetX + at.x - prev.x, offsetY: fit.offsetY + at.y - prev.y }));
  };
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  useEffect(
    () => () => {
      const url = photoRef.current?.src;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [],
  );

  /* ---------------------------------------------------------- saving */

  const filename = listingFilename(street);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const canvas = renderFull(doc, art, photoRef.current);
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
      setStep(5);
    } catch {
      setProblem("Something went wrong making the picture. Please press the button again.");
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    const url = photoRef.current?.src;
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    photoRef.current = null;
    setPhoto(null);
    setStreet("");
    setTown("");
    setBadge("");
    setOwnWords(false);
    setMoving(false);
    setHeld(null);
    setSavedName(null);
    setProblem(null);
    setStep(1);
  };

  /* ---------------------------------------------------------- the page */

  const back = (to: Step) => (
    <button type="button" className="tb-back" onClick={() => setStep(to)}>
      ← Back
    </button>
  );

  const preview = (
    <div
      className={`lg-preview${dropping ? " lg-dropping" : ""}`}
      onDragOver={(e) => {
        if (step !== 2) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (step !== 2) return;
        e.preventDefault();
        setDropping(false);
        pickPhoto(e.dataTransfer.files?.[0]);
      }}
    >
      <canvas
        ref={previewRef}
        className={step === 2 && photo ? "lg-canvas lg-grab" : "lg-canvas"}
        style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }}
        aria-label="Your listing post"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );

  const problemNote = problem && (
    <p className="tb-problem" role="alert">
      {problem}
    </p>
  );

  const variant = (change: Partial<Parameters<typeof buildDoc>[0]>) =>
    buildDoc({ photo, layout, headshot, street, town, badge, ...change });

  return (
    <div className="title">
      <header className="listing-head">
        <h1>ANGELA RERA - LISTING POSTS</h1>
        {onHome ? (
          <button type="button" className="listing-elsewhere listing-home-btn" onClick={onHome}>
            ← Home
          </button>
        ) : (
          <a href="#/angela" className="listing-elsewhere">
            ← Home
          </a>
        )}
      </header>

      <main className="tb">
        <p className="tb-progress" aria-label={`Step ${step} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i < step ? "tb-dot tb-dot-on" : "tb-dot"} aria-hidden />
          ))}
          <span>
            Step {step} of {STEPS}
          </span>
        </p>

        {step === 1 && (
          <section className="tb-step">
            <h2 ref={headingRef} tabIndex={-1}>
              Which house is it?
            </h2>
            <label className="lg-label" htmlFor="post-street">
              Street address
            </label>
            <input
              id="post-street"
              className="tb-input lg-line"
              value={street}
              autoComplete="off"
              placeholder="For example: 373 Meetinghouse Ln"
              onChange={(e) => setStreet(e.target.value)}
            />
            <label className="lg-label" htmlFor="post-town">
              Town, state and ZIP
            </label>
            <input
              id="post-town"
              className="tb-input lg-line"
              value={town}
              autoComplete="off"
              placeholder="For example: Lancaster, PA 17601"
              onChange={(e) => setTown(e.target.value)}
            />
            {street.trim().length > LONG_STREET && (
              <p className="tb-note">That's a long street name, so it will be set a little smaller. That's fine.</p>
            )}
            <p className="tb-hint">Your Instagram, phone number and website are added for you.</p>
            <button
              type="button"
              className="tb-primary"
              disabled={!street.trim() || !ready}
              onClick={() => setStep(2)}
            >
              {ready ? "Next: add the photo" : "Getting ready…"}
            </button>
            {!street.trim() && <p className="tb-hint">Type the street address above, then press the button.</p>}
          </section>
        )}

        {step === 2 && (
          <section className="tb-step">
            {back(1)}
            <h2 ref={headingRef} tabIndex={-1}>
              Add the photo of the house
            </h2>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="listing-file"
              onChange={(e) => {
                pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button type="button" className={photo ? "tb-secondary" : "tb-primary"} onClick={() => fileRef.current?.click()}>
              {photo ? "Choose a different photo" : "Choose the house photo"}
            </button>
            {!photo && !COARSE && <p className="tb-hint">Or drag a photo from a folder onto the picture below.</p>}
            {problemNote}
            {preview}
            {photo && (
              <>
                {!moving ? (
                  <button type="button" className="tb-secondary" onClick={() => setMoving(true)}>
                    Move the photo
                  </button>
                ) : (
                  <div className="lg-move">
                    <p className="lg-move-how">
                      {COARSE ? "Drag the photo with your finger to move it." : "Drag the photo with your mouse to move it."}
                    </p>
                    <div className="lg-move-row">
                      <button type="button" className="tb-secondary" onClick={() => zoomBy(1.15)}>
                        + Bigger
                      </button>
                      <button type="button" className="tb-secondary" onClick={() => zoomBy(1 / 1.15)}>
                        − Smaller
                      </button>
                    </div>
                    <button
                      type="button"
                      className="tb-back lg-reset"
                      onClick={() => setFit(() => ({ zoom: 1, offsetX: 0, offsetY: 0 }))}
                    >
                      Put it back how it was
                    </button>
                  </div>
                )}
              </>
            )}
            <button type="button" className="tb-primary" disabled={!photo} onClick={() => setStep(3)}>
              Next: sold or pending?
            </button>
            {!photo && <p className="tb-hint">Choose the house photo, then press the button.</p>}
          </section>
        )}

        {step === 3 && (
          <section className="tb-step">
            {back(2)}
            <h2 ref={headingRef} tabIndex={-1}>
              Sold or pending?
            </h2>
            <p className="tb-lead">Tap one.</p>
            <div className="lg-choices">
              {BADGES.map((b) => (
                <MiniPost
                  key={b.key}
                  id={`badge-${b.key}`}
                  doc={variant({ badge: b.text })}
                  art={art}
                  photo={photoRef.current}
                  redraw={fontReady}
                  on={!ownWords && badge === b.text}
                  label={b.label}
                  onPick={() => {
                    setOwnWords(false);
                    setBadge(b.text);
                  }}
                />
              ))}
            </div>
            {!ownWords ? (
              <button
                type="button"
                className="tb-back"
                onClick={() => {
                  setOwnWords(true);
                  setBadge("");
                }}
              >
                Something else…
              </button>
            ) : (
              <>
                <label className="lg-label" htmlFor="post-badge">
                  Your own words (for example: JUST LISTED!)
                </label>
                <input
                  id="post-badge"
                  className="tb-input lg-line"
                  value={badge}
                  autoComplete="off"
                  onChange={(e) => setBadge(e.target.value)}
                />
              </>
            )}
            {preview}
            <button type="button" className="tb-primary" onClick={() => setStep(4)}>
              Next: your photo
            </button>
          </section>
        )}

        {step === 4 && (
          <section className="tb-step">
            {back(3)}
            <h2 ref={headingRef} tabIndex={-1}>
              Which photo of you?
            </h2>
            <p className="tb-lead">Tap the one you like.</p>
            <div className="lg-choices">
              {HEADSHOTS.map((h) => (
                <MiniPost
                  key={h.key}
                  id={`you-${h.key}`}
                  doc={variant({ headshot: h.key })}
                  art={art}
                  photo={photoRef.current}
                  redraw={fontReady}
                  on={headshot === h.key}
                  label={h.label}
                  onPick={() => setHeadshot(h.key)}
                />
              ))}
            </div>
            <p className="tb-lead">Which side should your photo go on?</p>
            <div className="lg-choices lg-two">
              {LAYOUTS.map((l) => (
                <MiniPost
                  key={l.key}
                  id={`side-${l.key}`}
                  doc={variant({ layout: l.key })}
                  art={art}
                  photo={photoRef.current}
                  redraw={fontReady}
                  on={layout === l.key}
                  label={l.key === "standard" ? "On the left" : "On the right"}
                  onPick={() => setLayout(l.key)}
                />
              ))}
            </div>
            <p className="tb-lead">Here's your post:</p>
            {preview}
            <button type="button" className="tb-primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Looks good — save it"}
            </button>
            {problemNote}
            {failed.length > 0 && (
              <p className="tb-hint">Some of the artwork didn't load. Please reload the page and try again.</p>
            )}
          </section>
        )}

        {step === 5 && (
          <section className="tb-step">
            {back(4)}
            {held ? (
              <>
                <h2 ref={headingRef} tabIndex={-1}>
                  One more tap to save it
                </h2>
                <p className="tb-lead">
                  Press and hold the picture below, then tap <strong>Save to Photos</strong>.
                </p>
                <img className="tb-held" src={held} alt="Your listing post" />
              </>
            ) : (
              <>
                <h2 ref={headingRef} tabIndex={-1}>
                  ✓ Saved!
                </h2>
                <p className="tb-lead">
                  Your post is in your <strong>Downloads</strong> folder. It's called:
                </p>
                <p className="tb-filename">{savedName}</p>
              </>
            )}
            <button type="button" className="tb-secondary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "It didn't save — try again"}
            </button>
            {problemNote}

            <h3 className="lg-h3">Put it on Instagram</h3>
            <div className="lg-tabs" role="group" aria-label="Where are you posting from?">
              <button
                type="button"
                className={postFrom === "laptop" ? "tb-choice tb-choice-on" : "tb-choice"}
                aria-pressed={postFrom === "laptop"}
                onClick={() => setPostFrom("laptop")}
              >
                From this computer
              </button>
              <button
                type="button"
                className={postFrom === "phone" ? "tb-choice tb-choice-on" : "tb-choice"}
                aria-pressed={postFrom === "phone"}
                onClick={() => setPostFrom("phone")}
              >
                From my phone
              </button>
            </div>
            <ol className="tb-howto">
              {(postFrom === "laptop" ? POST_FROM_LAPTOP : POST_FROM_PHONE).map((s, i) => (
                <li key={i}>{s.replace("{name}", savedName ?? filename)}</li>
              ))}
            </ol>
            <button type="button" className="tb-primary" onClick={startOver}>
              Make another post
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
