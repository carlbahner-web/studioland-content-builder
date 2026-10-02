import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// One app, one entry point. This tool was prototyped as a second entry point
// inside the CRM repo (ss-frontend), where it had to be gated behind a
// BUILD_STUDIO env var so it could not ship to the live CRM by accident. Here
// it is the whole site, so that gate is gone rather than carried over.
//
// It still has no sign-in. If this is ever deployed somewhere public, put
// something in front of it first - see the README.
//
// BASE_PATH exists for GitHub Pages, which serves a project site from a
// SUBDIRECTORY (/studioland-content-builder/) rather than from the root. Every
// built URL - the JS, the CSS, the fonts and brand images in public/ - has to
// carry that prefix or the page loads and then quietly fetches nothing. Dev,
// `npm run build` and the single-file build all leave it unset and get "/",
// which is what they want; only the Pages workflow sets it.
//
// Two pages. index.html is the layer editor; angela/index.html is only a
// redirect now - Angela's Post Builder moved to her own site
// (carlbahner-web/angelarerarealestate, at /builder/) and the old address
// forwards there so her bookmark keeps working.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        angela: resolve(import.meta.dirname, "angela/index.html"),
      },
    },
  },
});
