import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { passengerAssets } from './scripts/passenger-assets.ts'

// The game is its own app, its own build and its own Worker (PLAN.md §1.2).
// `base: './'` keeps the build portable if it is ever served from a path prefix
// instead of the Worker's own domain root (PLAN.md §5).
export default defineConfig({
  base: './',
  plugins: [react(), passengerAssets(), {
    name: 'english-game-assets',
    // Production, development, and preview all need the same alias because
    // the portable build is also served from the /en/ path.
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/en/assets/') || request.url?.startsWith('/en/module-thumbnails/')) request.url = request.url.slice(3)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/en/assets/') || request.url?.startsWith('/en/module-thumbnails/')) request.url = request.url.slice(3)
        next()
      })
    },
  }],
  // The art site owns 5173; the game sits beside it. In development the site
  // links straight at this server (http://localhost:5174/ and /en/) instead of
  // going through the deployed /game prefix.
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
