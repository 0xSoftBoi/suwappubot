import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  // Keep node-llama-cpp as an external dep – it ships native binaries
  // that must not be bundled.
  external: ["node-llama-cpp"],
  // Preserve __dirname / __filename shims for ESM
  shims: true,
  clean: true,
  minify: false,
  sourcemap: false,
});
