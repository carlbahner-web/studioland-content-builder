import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One app, one entry point. This tool was prototyped as a second entry point
// inside the CRM repo (ss-frontend), where it had to be gated behind a
// BUILD_STUDIO env var so it could not ship to the live CRM by accident. Here
// it is the whole site, so that gate is gone rather than carried over.
//
// It still has no sign-in. If this is ever deployed somewhere public, put
// something in front of it first - see the README.
export default defineConfig({
  plugins: [react()],
});
