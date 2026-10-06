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
  canvasTexture,
  createModelMaterials,
  disposeModelMaterials,
  disposeObject,
  litPanelMaterial,
  type ModelMaterials,
  type ModuleContext,
} from '../render/models.ts'
import { createMaterials } from '../render/materials.ts'
import { createAdArt } from '../render/adArt.ts'
import { createLineMapArt } from '../render/lineMapArt.ts'
import { calligraphyPlate, drawCalligraphyPanel } from '../render/calligraphyFace.ts'
import { drawLineMapPlaceholder, lineMapPlaceholderPlate } from '../render/lineMapFace.ts'
import { drawStationDisplay, STATION_PLATE, tvLineStatus } from '../render/stationDisplay.ts'
import { drawSignPanel } from '../render/signFace.ts'
import { loadPictograms } from '../render/pictograms.ts'
import { makeSignBoards, signPlate } from '../sim/sign.ts'
import { DEFAULT_CALLIGRAPHY_AXIS, DEFAULT_CALLIGRAPHY_STYLE, calligraphyGeometry, isCalligraphyAxis, isCalligraphyStyle } from '../sim/calligraphy.ts'
import { DEFAULT_GLASS_VARIANT, glassSpec } from '../sim/glassPanels.ts'
import { DEFAULT_DOOR_VARIANT, doorSpec } from '../sim/doors.ts'
import { DEFAULT_LINE_MAP_VARIANT, lineMapSpec } from '../sim/linemaps.ts'
import { liftModule } from '../sim/lifts.ts'
import { stairFlightsFor, type StairStyle } from '../sim/stairs.ts'
import { BILLBOARD_SPECS, posterFor, type AdPoster } from '../sim/billboards.ts'
import { benchSpec } from '../sim/benches.ts'
import type { BenchVariant, BillboardShape, BillboardVariant, CalligraphyAxis, CalligraphyStyle, DoorVariant, ExitBays, GlassVariant, LineMapVariant, Module, StationData, Vec3i } from '../sim/types.ts'
import { MODULE_OPTIONS } from './store.ts'

/** The isometric direction the game opens on (`SceneRenderer.setPreset('iso')`). */
const ISO = new THREE.Vector3(1, -1.2, 0.85).normalize()
/** A climbing run (escalator, stair) reads as a staircase from the side. */
const RUN = new THREE.Vector3(1, -0.45, 0.72).normalize()
/** Wall-mounted decor faces +y, so its thumbnail looks at the lit front. */
const FRONT = new THREE.Vector3(1, 1.15, 0.8).normalize()
/**
 * The 时钟's dial faces straight down, so its icon is shot from low and to one
 * side: the white face, its black markers and the round bezel are all the tile needs
 * to say "clock", and the ceiling rod still reads as the stem above it.
 */
const CLOCK = new THREE.Vector3(0.9, 0.75, -0.55).normalize()
/** The 监控's readable angle: its lens front and a little below it. */
const CEILING = new THREE.Vector3(1, 1, -0.17).normalize()

/**
 * The poster each silhouette's palette thumbnail shows. Fixed rather than
 * rolled, so the rail's icons are the same on every launch and a format's icon
 * cannot change under the pointer — the walls themselves roll their poster at
 * placement, but a menu is documentation. The map is typed by silhouette, so a
 * new panel shape cannot be added without naming its icon.
 */
const SILHOUETTE_POSTER: Record<BillboardShape, AdPoster> = {
  landscape: posterFor('metro-security'),
  wide: posterFor('heinz-league'),
  panorama: posterFor('yupao-hiring'),
  portrait: posterFor('games-2025-red'),
  square: posterFor('heinz-body'),
}

/** Which way to look at a given piece, so its silhouette is the readable one. */
function viewDir(id: string): THREE.Vector3 {
  // Wall-mounted decor faces +y, so its thumbnail looks at the lit front — for
  // every billboard format (`billboard-wide`, `-portrait`, `-square`, `-large`),
  // the glass panels, the station-name inscriptions and the two network maps. A
  // **门** is floor-standing (it carries its own frame), but the readable face of a
  // door is its leaf, which is the same view.
  if (
    id === 'tv' ||
    id === 'billboard' ||
    id.startsWith('billboard-') ||
    id.startsWith('glass') ||
    id.startsWith('door') ||
    id.startsWith('calligraphy') ||
    id.startsWith('linemap')
  ) {
    return FRONT
  }
  // The 指示牌 is a double-sided board; look straight at its printed face.
  if (id === 'sign') return FRONT
  // A 时钟 is a dial facing **down**: from the isometric angle its icon would be
  // the bezel's dark top and nothing else, so its tile looks up at the face from
  // below the piece. A 监控 reads from the front and slightly below, where its lens
  // and hood are.
  if (id === 'clock') return CLOCK
  if (id === 'cctv') return CEILING
  // A backed seat reads best from the front (its cushions and arms), but the
  // backless stainless bench has nothing to hide and looks best on the lit
  // isometric angle.
  if (id.startsWith('bench-seat')) return FRONT
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
    for (let y = -6; y <= 10; y++) {
      cells.push({ x, y, z: 0, fill: 'solid' })
      // A couple of upper storeys, so a tall piece (a lift) has landings to
      // read; the thumbnail scene draws only the module, never these slabs.
      cells.push({ x, y, z: 4, fill: 'solid' })
      cells.push({ x, y, z: 8, fill: 'solid' })
    }
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
        psd: 'full',
        headwayProfile: { peak: 150, offpeak: 240, late: 480 },
        alightPerTrain: 420,
        terminus: 'through',
        direction: 'up',
        upTerminus: '',
        downTerminus: '',
        travelSign: 1,
        stations: [],
      },
    ],
  }
}

/** One representative instance of each palette entry, placed at the origin. */
function sampleModule(id: string, station: StationData): Module | null {
  switch (id) {
    case 'gate':
      // The palette tile shows the default lane gate; the choice itself is Tab.
      return { id, type: 'gate', x: 0, y: 0, z: 0, rot: 0, cfg: { dir: 'both', door: 'lane' } }
    case 'fence':
      return { id, type: 'fence', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'tvm':
      return { id, type: 'tvm', x: 0, y: 0, z: 0, cfg: {} }
    case 'vending':
      return { id, type: 'vending', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'bench':
    case 'bench-steel-1':
    case 'bench-steel-2':
    case 'bench-seat-1':
    case 'bench-seat-2': {
      const variant: BenchVariant = id === 'bench' ? 'steel-1' : (id.slice('bench-'.length) as BenchVariant)
      const spec = benchSpec(variant)
      return { id, type: 'bench', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'shelf':
      return { id, type: 'shelf', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'desk':
      return { id, type: 'desk', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'cubicle':
      return { id, type: 'cubicle', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'sink':
      return { id, type: 'sink', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'bin':
      return { id, type: 'bin', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'extinguisher':
      return { id, type: 'extinguisher', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'clock':
      return { id, type: 'clock', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'cctv':
      return { id, type: 'cctv', x: 0, y: 0, z: 0, rot: 0, cfg: {} }
    case 'billboard-wide':
    case 'billboard-standard':
    case 'billboard-large':
    case 'billboard-panorama':
    case 'billboard-portrait':
    case 'billboard-square': {
      const variant = id.slice('billboard-'.length) as BillboardVariant
      const spec = BILLBOARD_SPECS[variant] ?? BILLBOARD_SPECS.wide
      // Each format's thumbnail shows a real poster cut for its own silhouette,
      // so the sub-menu reads as six different ads rather than one ad in six
      // frames. The choice is by silhouette, so it is stable for a given format.
      const shape = BILLBOARD_SPECS[variant]?.shape ?? 'landscape'
      const poster = SILHOUETTE_POSTER[shape]
      return { id, type: 'billboard', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { variant: spec.variant, poster: poster.slug } }
    }
    case 'tv':
      return { id, type: 'tv', x: 0, y: 0, z: 0, rot: 0, cfg: { poster: SILHOUETTE_POSTER.landscape.slug } }
    case 'glass':
    case 'glass-1x1':
    case 'glass-2x1':
    case 'glass-3x1':
    case 'glass-1x2':
    case 'glass-2x2':
    case 'glass-3x2': {
      const variant: GlassVariant = id === 'glass' ? DEFAULT_GLASS_VARIANT : (id.slice('glass-'.length) as GlassVariant)
      const spec = glassSpec(variant)
      // The sample is drawn at its own run's centre, exactly as a placed piece is,
      // so a three-cell panel's icon is the wide window the tile promises.
      return { id, type: 'glass', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'door':
    case 'door-steel-1':
    case 'door-steel-2':
    case 'door-wood-1':
    case 'door-wood-2': {
      const variant: DoorVariant = id === 'door' ? DEFAULT_DOOR_VARIANT : (id.slice('door-'.length) as DoorVariant)
      const spec = doorSpec(variant)
      // The sample is drawn at its own run's centre, exactly as a placed piece is, so
      // a 双开 door's icon is the wide pair its tile promises rather than one leaf.
      return { id, type: 'door', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { variant: spec.variant } }
    }
    case 'calligraphy':
    case 'calligraphy-kai-h':
    case 'calligraphy-kai-v':
    case 'calligraphy-xing-h':
    case 'calligraphy-xing-v':
    case 'calligraphy-li-h':
    case 'calligraphy-li-v':
    case 'calligraphy-wei-h':
    case 'calligraphy-wei-v':
    case 'calligraphy-hei-h':
    case 'calligraphy-hei-v':
    case 'calligraphy-song-h':
    case 'calligraphy-song-v': {
      // Each tile prints the **synthetic station's** own name in its own hand, so
      // the sub-menu reads as one name written twelve ways rather than twelve
      // placeholder plates — the same code path a placed piece takes.
      const parts = id.split('-')
      const style = (isCalligraphyStyle(parts[1]) ? parts[1] : DEFAULT_CALLIGRAPHY_STYLE) as CalligraphyStyle
      const axis = (isCalligraphyAxis(parts[2]) ? parts[2] : DEFAULT_CALLIGRAPHY_AXIS) as CalligraphyAxis
      const geo = calligraphyGeometry(station.name, axis)
      return { id, type: 'calligraphy', x: 0, y: 0, z: 0, rot: 0, w: geo.cells, panelH: geo.panelH, cfg: { style, axis } }
    }
    case 'linemap':
    case 'linemap-wall':
    case 'linemap-stand': {
      const mount: LineMapVariant = id === 'linemap-stand' ? 'stand' : DEFAULT_LINE_MAP_VARIANT
      const spec = lineMapSpec(mount)
      return { id, type: 'linemap', x: 0, y: 0, z: 0, rot: 0, w: spec.w, cfg: { mount: spec.variant } }
    }
    case 'sign': {
      // The palette icon shows the front a fresh click would hang — the same default
      // `createModule` builds for a piece placed with no composed boards — and the
      // same empty back, because a thumbnail of the back would be a black tile.
      const boards = makeSignBoards(undefined, station)
      return { id, type: 'sign', x: 0, y: 0, z: 0, rot: 0, cfg: { front: boards.front, back: boards.back } }
    }
    case 'exit':
    case 'exit-covered-1':
    case 'exit-covered-2':
    case 'exit-covered-3':
    case 'exit-uncovered-1':
    case 'exit-uncovered-2':
    case 'exit-uncovered-3': {
      const parts = id.split('-')
      const covered = parts[1] !== 'uncovered'
      const n = Number(parts[2])
      const bays: ExitBays = n === 1 || n === 3 ? n : 2
      return { id, type: 'exit', x: 0, y: 0, z: 0, rot: 0, cfg: { name: 'C口', inRate: 900, open: true, covered, bays } }
    }
    case 'escalator':
      return { id, type: 'escalator', x: 0, y: 0, z: 0, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 6, z: 4 }, cfg: { dir: 'up' } }
    case 'lift':
      return liftModule({ x: 0, y: 0, z: 0 }, 0, id)
    case 'stair-straight':
      return sampleStair('straight')
    case 'stair-left90':
      return sampleStair('left90')
    case 'stair-right90':
      return sampleStair('right90')
    case 'stair-right180':
      return sampleStair('right180')
    case 'stair-left180':
      return sampleStair('left180')
    default:
      return null
  }
}

function sampleStair(style: StairStyle) {
  const base: Vec3i = { x: 0, y: 0, z: 0 }
  // The sample is drawn a shade wider than one lane so a wide flight and a
  // switchback's two runs both read in the tile; the flights are built at that
  // same width, so a switchback's return run is laid as far across as the model.
  const width = 1.6
  const flights = stairFlightsFor(base, 0, style, width)
  return {
    id: `stair-${style}`,
    type: 'stair' as const,
    x: 0,
    y: 0,
    z: 0,
    from: flights[0].from,
    to: flights[flights.length - 1].to,
    cfg: { width, style, flights },
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

/**
 * The point a tile's camera is aimed at. Everything frames its own bounding-sphere
 * centre; the two ceiling-hung decorations are the exception, because their centre
 * is the middle of an empty storey below the hardware (see `viewDir`).
 */
function aimPoint(id: string, sphere: THREE.Sphere): THREE.Vector3 {
  if (id === 'clock' || id === 'cctv') {
    return sphere.center.clone().add(new THREE.Vector3(0, 0, sphere.radius * 0.42))
  }
  return sphere.center.clone()
}

/** Render every palette entry once. Throws if WebGL is unavailable. */
export async function renderModuleThumbnails(size = 132): Promise<Record<string, string>> {
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
  const ads = createAdArt(renderer)
  // The 广告牌 and 电视 icons print real posters, so wait for the artwork before
  // drawing them; the whole pass is already deferred off the first paint.
  await ads.load(() => {})
  // A 线网图 icon is the **supplied** 线网示意图, so it waits for that poster too — a
  // tile drawn before it lands would show the drawn placeholder board and keep it for
  // the session, because the tiles are cached.
  const lineMaps = createLineMapArt(renderer)
  await lineMaps.load()
  // The 指示牌 icon prints the board's own pictograms, which are bitmaps: await
  // them for the same reason, because a tile drawn without them shows a board with
  // its marks missing and the tiles are cached for the session.
  await loadPictograms()
  const station = syntheticStation()
  // A thumbnail has no live service to print, so the 电视 plate shows the station
  // name and a blank clock — the same shape the placed piece draws.
  const plateCache = new Map<string, THREE.Texture>()
  /**
   * The two printed 装饰 faces the tiles need — a 站名's ink and a 线网图's board —
   * kept apart from `plateCache` because a face is a **material** over a texture, not
   * a bare texture (a mesh handed a texture where it expects a material cannot draw).
   * Released with the rest of the pass in the `finally` below.
   */
  const faceCache = new Map<string, THREE.Material>()
  const ctx: ModuleContext = {
    mats,
    ads,
    data: station,
    trackCells: new Set(['0,-1,0']),
    finish: (id) => finishes.finish(id),
    tvPlate: (id) => {
      let t = plateCache.get(id)
      if (!t) {
        t = canvasTexture(STATION_PLATE.width, STATION_PLATE.height, (g) => {
          drawStationDisplay(g, tvLineStatus(station.lines[0], [], [0.5, 0.5]), station.name, '08:20')
        })
        plateCache.set(id, t)
      }
      return t
    },
    // The 指示牌 icon prints the station's own 2号线 shield, so the palette shows
    // what a click actually hangs rather than a placeholder board. The canvas is
    // cut to the **pair's** shared panel, which is what makes a wide board's icon
    // wider than a narrow one's and keeps the front and back plates the same size.
    // A face is a **material** over that texture, the same shape the scene hands the
    // model.
    signFace: (id, layout, face, panel) => {
      const key = `sign|${id}|${face}|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
      let t = plateCache.get(key)
      if (!t) {
        const plate = signPlate(panel)
        t = canvasTexture(plate.width, plate.height, (g) => {
          drawSignPanel(g, layout, { lines: station.lines, panel }, face)
        })
        plateCache.set(key, t)
      }
      return litPanelMaterial(t)
    },
    // A 站名 icon is the synthetic station's own name in that hand and axis —
    // real drawing code, so the sub-menu shows twelve hands rather than twelve tiles.
    calligraphyFace: (id, spec) => {
      const key = `calligraphy|${id}|${spec.style}|${spec.axis}|${spec.panel.w.toFixed(3)}x${spec.panel.h.toFixed(3)}`
      const cached = faceCache.get(key) as THREE.MeshBasicMaterial | undefined
      if (cached) return { material: cached, texture: cached.map ?? undefined }
      const plate = calligraphyPlate(spec.panel)
      const texture = canvasTexture(plate.width, plate.height, (g) => {
        drawCalligraphyPanel(g, { text: station.name, style: spec.style, axis: spec.axis, panel: spec.panel })
      })
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide })
      faceCache.set(key, material)
      return { material, texture }
    },
    // A 线网图 icon is the supplied 线网示意图 itself, mounted exactly as a placed map
    // mounts it: the poster's own quad (its UV window is the crop that fits the panel)
    // and the art's shared material. The drawn placeholder board is the fallback for a
    // pass whose poster did not decode.
    lineMapFace: (id, panel) => {
      if (lineMaps.ready()) {
        const painted = lineMaps.face(panel.w, panel.h)
        return { material: painted.material, geometry: painted.geometry }
      }
      const key = `linemap|${id}|${panel.w.toFixed(3)}x${panel.h.toFixed(3)}`
      const cached = faceCache.get(key)
      if (cached) return { material: cached }
      const plate = lineMapPlaceholderPlate(panel)
      const texture = canvasTexture(plate.width, plate.height, (g) => {
        drawLineMapPlaceholder(g, { lines: station.lines, stationName: station.name, panel })
      })
      const material = litPanelMaterial(texture)
      faceCache.set(key, material)
      return { material }
    },
  }

  try {
    for (const opt of MODULE_OPTIONS) {
      const mod = sampleModule(opt.id, station)
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
      // A hung piece fills a whole storey, so its bounding sphere is twice as tall
      // as it is wide and its centre sits *below* the part that reads: the 时钟's
      // dial, the 监控's head. Those two tiles aim a little above the centre, which
      // is what brings the face and the lens into the icon instead of leaving a
      // frame of empty storey around a stem.
      const aim = aimPoint(opt.id, sphere)
      camera.position.copy(aim).addScaledVector(dir, r * 6)
      camera.near = r * 0.02
      camera.far = r * 40
      camera.lookAt(aim)
      camera.updateProjectionMatrix()

      renderer.render(scene, camera)
      out[opt.id] = renderer.domElement.toDataURL('image/png')

      scene.remove(group)
      disposeObject(group)
    }
  } finally {
    disposeModelMaterials(mats)
    ads.dispose()
    // The 站名 ink and the 线网图 boards are minted for the tiles alone: nothing in
    // the scene shares them, so they go with the pass (each wraps a canvas of its
    // own, and the pass is one-shot for the session).
    for (const mat of faceCache.values()) {
      const map = (mat as THREE.MeshBasicMaterial).map
      if (map) map.dispose()
      mat.dispose()
    }
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
        // The pass awaits the ad artwork (see `renderModuleThumbnails`), so it
        // resolves a promise rather than a record.
        renderModuleThumbnails()
          .then((rendered) => {
            cache = rendered
            resolve(rendered)
          })
          .catch(() => {
            cache = {}
            resolve(cache)
          })
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
