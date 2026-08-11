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
  server: {
    // Not required for the single-threaded duckdb bundle we ship (GitHub Pages
    // cannot set these headers), but enabling them in dev lets us test the
    // cross-origin-isolated path locally.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
