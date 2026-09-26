/* The listing post builder on its own - the guided flow, the one Angela uses -
 * with no content builder behind it.
 *
 * This is the entry point for `npm run build:single -- --only=listing`, which
 * makes the one-file copy that gets published as a Claude artifact. It exists
 * rather than reusing src/main.tsx because that one bundles the whole layer
 * editor - 250kB of JavaScript and every brand asset - for a page that will
 * never route to it, and a one-file build is exactly where that cost lands on
 * the person waiting for it to open.
 *
 * Standalone in the literal sense: no router, so no hash to get wrong. The one
 * link it keeps is to the reel title builder, by that artifact's own URL (see
 * src/links.ts); the layer editor is not reachable from here at all.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ListingGuide from "./ListingGuide.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ListingGuide standalone />
  </StrictMode>,
);
