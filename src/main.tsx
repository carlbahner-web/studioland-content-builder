import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

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
    <App />
  </StrictMode>,
);
