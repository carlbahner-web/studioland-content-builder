/* The listing builder on its own, with no content builder behind it.
 *
 * This is the entry point for `npm run build:single -- --only=listing`, which
 * makes the one-file copy that gets published as a Claude artifact. It exists
 * rather than reusing src/main.tsx because that one bundles the whole layer
 * editor - 250kB of JavaScript and every brand asset - for a page that will
 * never route to it, and a one-file build is exactly where that cost lands on
 * the person waiting for it to open.
 *
 * Standalone in the literal sense: no router, so no hash to get wrong, and the
 * link back to the other tool is hidden because there is nothing there to link
 * to.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ListingBuilder from "./ListingBuilder.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ListingBuilder standalone />
  </StrictMode>,
);
