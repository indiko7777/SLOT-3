import { defineConfig } from "vite";

export default defineConfig({
  // Stake serves each uploaded game from a hashed SUB-PATH, not the domain root,
  // so every asset URL must be relative. "./" makes Vite emit ./assets/... in
  // index.html instead of /assets/... (an absolute /assets/ 404s on Stake and
  // the game loads blank). Mirrors StakeEngine/web-sdk's vite config.
  base: "./",
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
