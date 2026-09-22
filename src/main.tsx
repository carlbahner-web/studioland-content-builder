import { StrictMode, lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

/* Two tools, one bundle, told apart by the hash.
 *
 * The hash rather than a path because this is served by GitHub Pages, which has
 * no rewrites: a real route would 404 on reload and on anyone opening a shared
 * link, which is most of what a link is for. It also keeps the single-file
 * build working, where there is no server to rewrite anything.
 *
 *   (nothing)   the brand content builder - the general layer editor
 *   #/listing   the listing builder - one template, four controls
 *
 * The listing builder is lazy so that the artwork manifest and its module graph
 * cost nothing to whoever only wanted the other tool.
 */
const ListingBuilder = lazy(() => import("./listing/ListingBuilder.tsx"));

function route(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

function Router() {
  const [path, setPath] = useState(route);
  useEffect(() => {
    const onHash = () => setPath(route());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (path.startsWith("/listing")) {
    return (
      <Suspense fallback={<p className="boot-msg">Loading the listing builder…</p>}>
        <ListingBuilder />
      </Suspense>
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
