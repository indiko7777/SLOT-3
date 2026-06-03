import { defineConfig } from "vite";

// GitHub Pages serves at /SLOT-3/ (repo name).
// Override with VITE_BASE env var for other deployments (e.g. VITE_BASE=/ for prod).
const base = process.env.VITE_BASE ?? "/SLOT-3/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true
  },
  server: {
    port: 5175,
    strictPort: true
  },
  define: {
    global: "globalThis"
  },
  optimizeDeps: {
    include: ["@bokuweb/zstd-wasm"]
  }
});
