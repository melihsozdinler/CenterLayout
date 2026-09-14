import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from /<repo>/, local dev and `npx serve` from /.
// CI sets VITE_BASE=/CenterLayout/ ; everything else defaults to a relative base
// so that a downloaded `dist/` works when opened from any directory.
const base = process.env.VITE_BASE ?? './'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // duckdb-wasm ships its own workers; pre-bundling them breaks the worker URLs.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
  // No COOP/COEP headers. They were here to let the cross-origin-isolated DuckDB
  // path be tested locally, and they cost more than they were worth: with COEP set,
  // the browser refuses *every* cross-origin iframe, so the links out to BioGRID,
  // UniProt and IntAct rendered as "refused to connect" — locally only, since GitHub
  // Pages cannot set these headers and production was therefore fine. A bug that
  // appears only in development is worse than one that appears everywhere.
  //
  // The shipped DuckDB bundle is single-threaded and needs neither header.
})
