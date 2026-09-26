/* Angela's tools as one page - the entry point for her own address on the site
 * (angela/index.html) and for `npm run build:angela`, the one-file copy that
 * gets published as her Claude artifact.
 *
 * It opens on her home page ("What would you like to make?") with the
 * bookmark reminder, exactly like #/angela on the site, and switches between
 * the home page and the two guided tools by state rather than by the address:
 * an artifact frame does not route on anything but a plain #anchor, and there
 * is no server to send a route to. The brand content builder and the full
 * listing editor are not in this build at all.
 */
import { StrictMode, useState } from "react";
// The shared chrome - palette, the webfont, the base type - which the routed
// site gets through App. The one-file build inlines it itself and ignores this.
import "../studio.css";
import { createRoot } from "react-dom/client";
import AngelaHome from "./AngelaHome.tsx";
import type { Tool } from "./AngelaHome.tsx";
import ListingGuide from "../listing/ListingGuide.tsx";
import TitleBuilder from "../title/TitleBuilder.tsx";

function Angela() {
  const [tool, setTool] = useState<Tool | null>(null);
  const go = (next: Tool | null) => {
    setTool(next);
    window.scrollTo?.({ top: 0 });
  };
  if (tool === "listing") return <ListingGuide onHome={() => go(null)} />;
  if (tool === "title") return <TitleBuilder onHome={() => go(null)} />;
  return <AngelaHome onOpen={go} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Angela />
  </StrictMode>,
);
