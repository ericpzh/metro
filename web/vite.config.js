import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the built site works from a GitHub Pages project path
// (/<repo>/) as well as from a domain root, with no per-repo configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
})
