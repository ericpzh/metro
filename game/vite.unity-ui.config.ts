import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const zooEntryExists = existsSync(resolve(import.meta.dirname, 'src/unity-web/zooUi.tsx'))

const viewportPath = resolve(import.meta.dirname, 'src/app/Viewport.tsx').replaceAll('\\', '/')
const explodedViewPath = resolve(import.meta.dirname, 'src/app/windows/ExplodedView.tsx').replaceAll('\\', '/')
const sceneBarrelPath = resolve(import.meta.dirname, 'src/render/scene.ts').replaceAll('\\', '/')
const cameraSystemPath = resolve(import.meta.dirname, 'src/render/scene/systems/CameraSystem.ts').replaceAll('\\', '/')
const stubStationPaths = new Set([
  resolve(import.meta.dirname, 'src/data/tanwei-station.json').replaceAll('\\', '/'),
  resolve(import.meta.dirname, 'src/data/tianhe-station.json').replaceAll('\\', '/'),
])

// The Unity host supplies its own viewport, omits the Three.js exploded view, and
// owns the example-station documents in C# (`StationGameHost`); only the legacy
// `zoo` entry still reads `demo-station.json`. Stubbing these Three.js-only
// inputs keeps Three.js crowd buffers, city maps and unused multi-megabyte JSON
// station documents out of the WebGL shell bundle.
function unityHostStubs(): Plugin {
  return {
    name: 'metro-unity-host-stubs',
    enforce: 'pre',
    load(id) {
      const normalized = id.split('?')[0].replaceAll('\\', '/')
      if (normalized === viewportPath) {
        return [
          'export function isTypingTarget(target) {',
          '  if (!target) return false',
          '  const tag = target.tagName',
          "  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true",
          '}',
          'export function Viewport() { return null }',
        ].join('\n')
      }
      if (normalized === explodedViewPath) {
        return 'export function ExplodedView() { return null }\n'
      }
      if (normalized === sceneBarrelPath || normalized === cameraSystemPath) {
        return [
          'export class SceneRenderer {}',
          "export const PAN_UP = 'pan-up'",
          "export const PAN_DOWN = 'pan-down'",
          'export const DEFAULT_FOV = 45',
          'export const FOV_MIN_DEG = 30',
          'export const FOV_MAX_DEG = 120',
          'export class CameraSystem {}',
        ].join('\n')
      }
      if (stubStationPaths.has(normalized)) {
        return '{"name":"","storeyHeight":5,"seed":1,"cells":[],"modules":[],"lines":[]}'
      }
      return null
    },
  }
}

export default defineConfig({
  base: './', publicDir: false, plugins: [unityHostStubs(), react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-unity-ui', emptyOutDir: true, manifest: true,
    assetsInlineLimit: 0, target: 'es2022',
    rolldownOptions: {
      // Two shells share the same UI once `zooUi.tsx` is split out: the station
      // player (plan 11) and the legacy Zoo slice.
      input: zooEntryExists ? { station: 'src/unity-web/main.tsx', zoo: 'src/unity-web/zooUi.tsx' } : 'src/unity-web/main.tsx',
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
})
