import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { passengerAssets } from './scripts/passenger-assets.ts'
import { editorBenchmarkBuild } from './scripts/editor-benchmark-build.ts'

// Local CPU attribution uses compact maps plus the benchmark's source snapshot.
// Embedded demo JSON would push ordinary sourcesContent maps over the asset cap.
const benchmarkMaps = process.env.BENCH_SOURCE_MAP === '1'

// The game is its own app, its own build and its own Worker (PLAN.md §1.2).
// `base: './'` keeps the build portable if it is ever served from a path prefix
// instead of the Worker's own domain root (PLAN.md §5).
export default defineConfig({
  base: './',
  plugins: [react(), passengerAssets(), editorBenchmarkBuild(), {
    name: 'english-game-assets',
    // Production, development, and preview need aliases because the portable
    // build uses relative assets on the /en/ and /benchmark/en routes.
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/en/assets/') || request.url?.startsWith('/en/module-thumbnails/')) request.url = request.url.slice(3)
        if (request.url?.startsWith('/benchmark/assets/') || request.url?.startsWith('/benchmark/module-thumbnails/')) request.url = request.url.slice('/benchmark'.length)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/en/assets/') || request.url?.startsWith('/en/module-thumbnails/')) request.url = request.url.slice(3)
        if (request.url?.startsWith('/benchmark/assets/') || request.url?.startsWith('/benchmark/module-thumbnails/')) request.url = request.url.slice('/benchmark'.length)
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
    sourcemap: benchmarkMaps,
    rolldownOptions: benchmarkMaps ? { output: { sourcemapExcludeSources: true } } : undefined,
  },
  worker: {
    format: 'es',
  },
})
