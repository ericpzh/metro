import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { passengerAssets } from './scripts/passenger-assets.ts'

export default defineConfig({
  base: './', publicDir: false, plugins: [react(), passengerAssets()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-unity-ui', emptyOutDir: true, manifest: true,
    assetsInlineLimit: 0, target: 'es2022',
    rolldownOptions: {
      input: 'src/unity-web/main.tsx',
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
})
