/* The reel title builder on its own - the entry point for
 * `npm run build:title`, which makes the one-file copy published as a Claude
 * artifact. Same reasoning as src/listing/main.tsx: no router, and none of the
 * layer editor's weight for a page that never routes to it. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TitleBuilder from "./TitleBuilder.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TitleBuilder standalone />
  </StrictMode>,
);
