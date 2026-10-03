// Equipment thumbnails for the build rail.
//
// The left rail shows the *actual* in-game equipment, not a stand-in glyph: this
// module builds each placeable module with the same procedural kit the 3D scene
// uses (`render/models.ts`) into an offscreen WebGL renderer and hands back a
// data URL. Once generated the result is cached for the session, so the only
// cost is one short render at startup, deferred off the first paint.

import * as THREE from 'three'
import {
  buildModule,
  createModelMaterials,
  disposeModelMaterials,
  disposeObject,
  type ModelMaterials,
  type ModuleContext,
} from '../render/models.ts'
import { createMaterials } from '../render/materials.ts'
import { stairFlightsFor, type StairStyle } from '../sim/stairs.ts'
import { BILLBOARD_SPECS } from '../sim/billboards.ts'
import type { BillboardVariant, Module, StationData, Vec3i } from '../sim/types.ts'
import { MODULE_OPTIONS } from './store.ts'

/** The isometric direction the game opens on (`SceneRenderer.setPreset('iso')`). */
const ISO = new THREE.Vector3(1, -1.2, 0.85).normalize()
/** A climbing run (escalator, stair) reads as a staircase from the side. */
const RUN = new THREE.Vector3(1, -0.45, 0.72).normalize()
/** Wall-mounted decor faces +y, so its thumbnail looks at the lit front. */
const FRONT = new THREE.Vector3(1, 1.15, 0.8).normalize()

/** Which way to look at a given piece, so its silhouette is the readable one. */
function viewDir(id: string): THREE.Vector3 {
  // Wall-mounted decor faces +y, so its thumbnail looks at the lit front — for
  // every billboard format (`billboard-wide`, `-portrait`, `-square`, `-large`).
  if (id === 'tv' || id === 'billboard' || id.startsWith('billboard-')) return FRONT
  return id === 'escalator' || id.startsWith('stair') ? RUN : ISO
}

/**
 * A throwaway station the size of a small hall, so a module that reads its
 * neighbours (a stair's floor finish, a PSD's track side) has something
 * sensible to read. Only the thumbnail builder ever sees it.
 */
function syntheticStation(): StationData {
  const cells: StationData['cells'] = []
  for (let x = -6; x <= 14; x++) {
    for (let y = -6; y <= 10; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  }
  // A track bed one cell north, for models that look for one.
  cells.push({ x: 0, y: -1, z: 0, fill: 'solid', finish: { top: 'floor.track' } })
  return {
    name: '地铁站',
    seed: 1,
    cells,
    modules: [],
    lines: [
      {
        id: '2',
        name: '2号线',
        colour: '#00679e',
        stock: 'B',
        cars: 6,
        power: 'third-rail',
        headwayProfile: { peak: 150, offpeak: 240, late: 480 },
        alightPerTrain: 420,
        terminus: 'through',
        direction: 'up',
        travelSign: 1,
        stations: [],
      },
    ],
  }
}

/** One representative instance of each palette entry, placed at the origin. */
function sampleModule(id: string): Module | null {
  switch (id) {
    case 'gate':
      return { id, type: 'gate', x: 0, y: 0, z: 0, rot: 0, cfg: { dir: 'both' } }
    case 'fence':
      return { id, type: 'fence', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'tvm':
      return { id, type: 'tvm', x: 0, y: 0, z: 0, cfg: {} }
    case 'bench':
      return { id, type: 'bench', x: 0, y: 0, z: 0, cfg: {} }
    case 'shelf':
      return { id, type: 'shelf', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'desk':
      return { id, type: 'desk', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'cubicle':
      return { id, type: 'cubicle', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'sink':
      return { id, type: 'sink', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'billboard-wide':
    case 'billboard-portrait':
    case 'billboard-square':
    case 'billboard-large': {
      const variant = id.slice('billboard-'.length) as BillboardVariant
      const spec = BILLBOARD_SPECS[variant] ?? BILLBOARD_SPECS.wide
      return { id, type: 'billboard', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'tv':
      return { id, type: 'tv', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'exit':
      return { id, type: 'exit', x: 0, y: 0, z: 0, rot: 0, cfg: { name: 'C口', inRate: 900, open: true } }
    case 'escalator':
      return { id, type: 'escalator', x: 0, y: 0, z: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 6, z: 4 }, cfg: { dir: 'up' } }
    case 'stair-straight':
      return sampleStair('straight')
    case 'stair-left90':
      return sampleStair('left90')
    case 'stair-right90':
      return sampleStair('right90')
    case 'stair-right180':
      return sampleStair('right180')
    default:
      return null
  }
}

function sampleStair(style: StairStyle) {
  const base: Vec3i = { x: 0, y: 0, z: 0 }
  const flights = stairFlightsFor(base, 0, style)
  return {
    id: `stair-${style}`,
    type: 'stair' as const,
    x: 0,
    y: 0,
    z: 0,
    from: flights[0].from,
    to: flights[flights.length - 1].to,
    cfg: { width: 1.6, style, flights },
  }
}

/**
 * World-space bounds that include instance matrices, which `Box3.setFromObject`
 * ignores — the escalator's step band is an `InstancedMesh`, and without this it
 * would frame only the first tread.
 */
function objectBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean }
    const geo = mesh.geometry
    if (!geo) return
    if (mesh.isInstancedMesh) {
      const im = mesh as THREE.InstancedMesh
      im.computeBoundingBox()
      if (im.boundingBox) box.union(im.boundingBox.clone().applyMatrix4(im.matrixWorld))
      return
    }
    if (!mesh.isMesh) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    if (geo.boundingBox) box.union(geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
  })
  return box
}

/** Render every palette entry once. Throws if WebGL is unavailable. */
export function renderModuleThumbnails(size = 132): Record<string, string> {
  const out: Record<string, string> = {}
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x1d2c3d, 1.15))
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(5, -7, 9)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x9ecbff, 0.85)
  fill.position.set(-7, 5, 4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0x4e8fd0, 0.7)
  rim.position.set(0, 7, -5)
  scene.add(rim)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  // The world is Z-up (see `SceneRenderer`), so the icon camera must be too —
  // otherwise the model renders lying on its side.
  camera.up.set(0, 0, 1)
  const mats: ModelMaterials = createModelMaterials()
  const finishes = createMaterials()
  const station = syntheticStation()
  const ctx: ModuleContext = { mats, data: station, trackCells: new Set(['0,-1,0']), finish: (id) => finishes.finish(id) }

  try {
    for (const opt of MODULE_OPTIONS) {
      const mod = sampleModule(opt.id)
      if (!mod) continue
      const group = buildModule(mod, ctx)
      if (!group) continue
      scene.add(group)

      const sphere = objectBox(group).getBoundingSphere(new THREE.Sphere())
      const r = Math.max(0.35, sphere.radius)
      const half = r * 1.22
      camera.left = -half
      camera.right = half
      camera.top = half
      camera.bottom = -half
      const dir = viewDir(opt.id)
      camera.position.copy(sphere.center).addScaledVector(dir, r * 6)
      camera.near = r * 0.02
      camera.far = r * 40
      camera.lookAt(sphere.center)
      camera.updateProjectionMatrix()

      renderer.render(scene, camera)
      out[opt.id] = renderer.domElement.toDataURL('image/png')

      scene.remove(group)
      disposeObject(group)
    }
  } finally {
    disposeModelMaterials(mats)
    for (const m of finishes.finishCache.values()) {
      m.map?.dispose()
      m.dispose()
    }
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return out
}

/* --------------------------------------------------------------- session cache */

let cache: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null

/** Thumbnails, generated once and shared by every caller. Empty on failure. */
export function getModuleThumbnails(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache)
  if (!pending) {
    pending = new Promise((resolve) => {
      const run = (): void => {
        try {
          cache = renderModuleThumbnails()
        } catch {
          cache = {}
        }
        resolve(cache)
      }
      // Off the critical path: a short WebGL pass, so let the first paint land.
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        ;(window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 1200 })
      } else {
        setTimeout(run, 60)
      }
    })
  }
  return pending
}
