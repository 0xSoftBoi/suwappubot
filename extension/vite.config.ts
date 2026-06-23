import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath, URL } from "node:url";
import manifest from "./manifest.config";

// MV3 build via @crxjs. The inpage provider is built as a separate
// web-accessible IIFE (see manifest web_accessible_resources) so it can be
// injected into the page's MAIN world by the content script.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        // Popup HTML is wired through the manifest action; inpage is a
        // standalone web-accessible script injected into the MAIN world.
        inpage: fileURLToPath(new URL("./src/inpage/index.ts", import.meta.url)),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
});
