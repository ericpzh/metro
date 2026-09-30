import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The game is its own app, its own build and its own Worker (PLAN.md §1.2).
// `base: './'` keeps the build portable if it is ever served from a path prefix
// instead of the Worker's own domain root (PLAN.md §5).
export default defineConfig({
  base: './',
  plugins: [react()],
  // The art site owns 5173; the game sits beside it so the site's 游戏 tab can
  // iframe the dev server without a port clash.
  server: { port: 5174, strictPort: false },
  preview: { port: 4174 },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
})
