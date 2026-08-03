import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    // No sourcemaps in the Stake upload — they added ~3.4 MB of .map files that
    // ship to players for zero runtime benefit. Flip to true only when debugging.
    sourcemap: false
  },
  server: {
    port: 5176,
    strictPort: true
  }
});
