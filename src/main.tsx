import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

/* The layer editor, and forwarding for Angela's old addresses.
 *
 * Angela's tools - her home page, the guided listing post, the reel title and
 * the full listing editor - used to live here behind #/angela, #/listing,
 * #/title and #/listing/advanced. They moved to her own site
 * (carlbahner-web/angelarerarealestate, at /builder/), so those hashes send the
 * browser there rather than to a page that no longer exists. replace(), not an
 * assignment, so the old address does not sit in the back-button history.
 */
const ANGELA = "https://carlbahner-web.github.io/angelarerarealestate/builder/";

function movedTo(hash: string): string | null {
  const path = hash.replace(/^#/, "");
  if (path.startsWith("/listing/advanced")) return `${ANGELA}advanced/`;
  if (/^\/(angela|listing|title)/.test(path)) return ANGELA;
  return null;
}

function Router() {
  const [moved, setMoved] = useState(() => movedTo(window.location.hash));
  useEffect(() => {
    const onHash = () => setMoved(movedTo(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (moved) window.location.replace(moved);
  }, [moved]);

  if (moved) {
    return (
      <p className="boot-msg">
        Angela's Post Builder has moved to <a href={moved}>{moved}</a>.
      </p>
    );
  }
  return <App />;
}

/* No sign-in. This IS hosted - GitHub Pages, see .github/workflows/pages.yml -
 * and it is hosted UNLISTED: nothing links to it, and it asks search engines not
 * to index it (index.html's robots meta and public/robots.txt). A stranger would
 * have to guess the URL. Pages offers no password protection at any tier, so the
 * URL is the whole of it.
 *
 * That is a deliberate call about what is actually at risk here. There is no
 * customer data, no key and no write path in this bundle - the worst a finder
 * could do is make a StudioLand-looking graphic, which is not worth a login in
 * front of a tool used from a phone. An earlier version gated it with Clerk
 * against an email allowlist; if that is ever wanted back, it is in the
 * prototype history in the CRM repo, under the commit "Host the generator at
 * /studio, gated by Clerk with an email allowlist".
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
