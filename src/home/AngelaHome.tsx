/* Angela's home page: the one address to keep, and the choice between her two
 * tools, before anything else.
 *
 * Two big cards and nothing else to do. The first time, and every visit after
 * until she says she has done it, a reminder to bookmark the page sits over
 * the top - the whole point of having one page is that she can always get
 * back to it. "Skip for now" really is for now: it is not remembered, so the
 * reminder comes back next visit. Only "I bookmarked it" puts it away for good.
 */
import { useEffect, useRef, useState } from "react";
import "../listing/listing.css";
import "./home.css";

const BOOKMARKED_KEY = "angela-home-bookmarked";

/* Storage can be missing or refuse (a private window, blocked site data). Then
 * the reminder simply shows every visit, which is the safe side to fail on. */
function bookmarked(): boolean {
  try {
    return localStorage.getItem(BOOKMARKED_KEY) === "yes";
  } catch {
    return false;
  }
}
function rememberBookmarked(): void {
  try {
    localStorage.setItem(BOOKMARKED_KEY, "yes");
  } catch {
    /* not remembered; the reminder shows again next time */
  }
}

/* The keys to press differ by machine. She is on a Windows laptop, where it is
 * Ctrl+D in every browser she is likely to have; a Mac or a phone gets its own
 * words, so whoever opens it there is not told to press a key they lack. */
function howToBookmark(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return "Tap the Share button (the square with an arrow at the bottom of the screen), then tap “Add Bookmark”, then tap “Save”.";
  }
  if (/Android/.test(ua)) {
    return "Tap the three dots at the top right of the screen, then tap the star.";
  }
  if (/Mac/.test(ua)) {
    return "Hold the Command key (⌘) and press D, then click “Done”.";
  }
  return "Hold the Ctrl key and press D, then click “Done”.";
}

function BookmarkReminder({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const firstButton = useRef<HTMLButtonElement>(null);

  // Focus starts on the main button; Escape counts as "Skip for now".
  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  return (
    <div className="home-backdrop">
      <div className="home-dialog" role="dialog" aria-modal="true" aria-labelledby="bookmark-title">
        <p className="home-dialog-star" aria-hidden>
          ★
        </p>
        <h2 id="bookmark-title">Bookmark this page</h2>
        <p>So you can always find your tools again.</p>
        <p className="home-dialog-how">{howToBookmark()}</p>
        <button ref={firstButton} type="button" className="home-primary" onClick={onDone}>
          I bookmarked it
        </button>
        <button type="button" className="home-secondary" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

export default function AngelaHome() {
  const [asking, setAsking] = useState(() => !bookmarked());

  return (
    <div className="home">
      {asking && (
        <BookmarkReminder
          onDone={() => {
            rememberBookmarked();
            setAsking(false);
          }}
          onSkip={() => setAsking(false)}
        />
      )}
      <header className="listing-head">
        <h1>ANGELA RERA</h1>
      </header>
      <main className="home-main" aria-hidden={asking || undefined}>
        <h2 className="home-question">What would you like to make?</h2>
        <div className="home-cards">
          <a className="home-card" href="#/listing">
            <span className="home-card-art home-card-post" aria-hidden>
              <span className="home-card-arch" />
            </span>
            <span className="home-card-name">A listing post</span>
            <span className="home-card-what">A picture for a house: sold, pending or just listed.</span>
          </a>
          <a className="home-card" href="#/title">
            <span className="home-card-art home-card-reel" aria-hidden>
              <span className="home-card-banner">TITLE</span>
            </span>
            <span className="home-card-name">A reel title</span>
            <span className="home-card-what">The banner that goes across the top of a video.</span>
          </a>
        </div>
      </main>
    </div>
  );
}
