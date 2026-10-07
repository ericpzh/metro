// Equipment thumbnails for the build rail.
//
// The left rail shows the *actual* in-game equipment, not a stand-in glyph: this
// module builds each placeable module with the same procedural kit the 3D scene
// uses (`render/models.ts`) into an offscreen WebGL renderer and hands back a
// data URL. Once generated the result is cached for the session, so the only
// cost is one short render at startup, deferred off the first paint.

import * as THREE from 'three'
import { addStationLights, applyStationRenderer } from '../render/scene/lightRig.ts'
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
import { DEFAULT_SIGN_MOUNT, makeSignBoards, signMountSpec, signPlate, type SignMount } from '../sim/sign.ts'
import { DEFAULT_CALLIGRAPHY_AXIS, DEFAULT_CALLIGRAPHY_STYLE, calligraphyGeometry, isCalligraphyAxis, isCalligraphyStyle } from '../sim/calligraphy.ts'
import { DEFAULT_GLASS_VARIANT, glassSpec } from '../sim/glassPanels.ts'
import { liftExtendedUp } from '../sim/lifts.ts'
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
/**
 * The two drawn sheets of a `views` capture: the game's own **isometric corner**, on the
 * drawing kit's screen axes.
 *
 * `tools/iso.mjs` projects with `px = (x - y) * TW`, `py = (x + y) * TH - z * ZU` — its
 * screen's right is `(1, -1, 0)` and its screen's up is `(-1, -1, 2)` — so a piece
 * photographed on those two rows lands in one of those scenes **undistorted**, exactly as
 * `captureTrains.ts`'s `iso` frames do for a car. That is the whole point of this mode: a
 * sheet that draws a station as an isometric volume can stand the game's own 扶梯 and
 * 楼梯 in it instead of drawing a box and calling it a staircase.
 *
 * The view is taken from **above** the corner (`+z`), because these are props on a floor:
 * a camera under the floor would be photographing a stair from inside the ground.
 */
const ISO_RIGHT = new THREE.Vector3(1, -1, 0).normalize()
const ISO_UP = new THREE.Vector3(-1, -1, 2).normalize()
/**
 * The kit's own `TW` — the drawing kit's isometric rows, from `tools/iso.mjs`. The picture is
 * framed in the kit's screen **pixels**, which are the units the kit's `px()` and `py()` return
 * and therefore the units every sheet is already drawing in.
 */
const ISO_TW = 30
/**
 * Pixels the drawing kit's projections are written in: one unit of `px()`/`py()` is a pixel,
 * which is the unit every sheet draws in.
 */
const PX_PER_KIT = ISO_TW

/**
 * The kit's screen rows are **isotropic**, and a frame photographed on them has to be too.
 *
 * There used to be a `ZU / TW` widening of the frustum here, on the argument that the kit draws
 * a metre of ground `(TW, TH)` across and `ZU` up — `ZU > TW` — so an orthographic camera, whose
 * pixels are square, has to be stretched to match. It is the wrong way round. A metre of the
 * kit's *screen* is `TW * √2` pixels along the across row **and** `TW * √2` along the down row —
 * `|(1, -1, 0)| * TW` on one and `|(TH, TH, -ZU)|` on the other, and `√(2·TH² + ZU²)` is
 * `TW * √2` — so the two rows measure a metre the same and a square-pixel camera already agrees
 * with the drawing. Widening the frustum by `ZU / TW` therefore did not match the kit, it made
 * the frame narrower than the piece: every 扶梯 and 楼梯 came back sliced off flat down both
 * sides, which is the same class of mistake as a train's cab cut by a margin — the picture's
 * own edge cutting the model.
 */

/**
 * The silhouette of a built piece in a **camera's own local space**, as `[x0, x1, y0, y1]`.
 *
 * Not the model's `objectBox`. A world-axis-aligned box is the wrong shape for this twice over:
 * a rotated part — which is what a 扶梯's truss and its step band are — has a world box far
 * larger than the part itself, and projecting the eight corners of a box the model does not
 * fill frames all the room it leaves. Measured on the escalator, that box came out a third
 * wider across and half again as tall as anything drawn, and a frame taken around it drew the
 * piece at a third of the size the sheet had room for.
 *
 * Every mesh's own geometry is walked instead, and its corners are taken into the camera's
 * space — exact for a box, because the projection is linear and a box's extreme projected
 * points are among its corners. An `InstancedMesh` is measured through its **instances**: the
 * step band reposes every one of them, so the mesh's own box is a single tread.
 *
 * Walking a mesh's *box* is not the same thing, and the difference is the whole reason this
 * function exists twice over. A box's eight corners, once a rotation is applied, are no longer
 * the extremes of anything: push a 7 m truss through 25° and the box around it comes back half
 * again as tall as the truss. `Box3.setFromObject` has the same hole and the same answer —
 * `precise: true`, every vertex — which is what this does. The vertices are already in memory
 * and a piece is a few thousand of them. A mesh that is not drawn is skipped: it is not in the
 * picture, so it cannot be what the picture has to hold.
 */
function localSilhouette(root: THREE.Object3D, camera: THREE.Camera): { x: [number, number]; y: [number, number] } {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  const m = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const point = new THREE.Vector3()
  root.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  /** Whether an object and every one of its ancestors is drawn. */
  const drawn = (o: THREE.Object3D) => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false
    return true
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry || !drawn(mesh)) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null
    for (let i = 0; i < (inst ? inst.count : 1); i++) {
      m.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
      if (inst) m.multiply(inst.getMatrixAt(i, local))
      for (let k = 0; k < pos.count; k++) {
        point.fromBufferAttribute(pos, k).applyMatrix4(m)
        if (point.x < x0) x0 = point.x
        if (point.x > x1) x1 = point.x
        if (point.y < y0) y0 = point.y
        if (point.y > y1) y1 = point.y
      }
    }
  })
  return { x: [x0, x1], y: [y0, y1] }
}
/**
 * How much room a `views` frame leaves around the piece.
 *
 * Barely any, because the silhouette it is measured from is the piece's own. `right` and `up`
 * are orthonormal and the frame is a rectangle in *their* space, so the two extents are the
 * extents; this is a hair of margin for an antialiased edge, plus a little more for the one
 * thing the measurement cannot see — a 扶梯's step band is an `InstancedMesh` reposed every
 * frame, and the box it is measured through is the band's own, not the treads standing proud
 * of it.
 */
const ISO_PAD = 1.03
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
  // A 指示牌 is composed of boards printed on its face — the hung one on both faces,
  // the wall one on the one face it has — so either tile looks straight at what it
  // prints.
  if (id.startsWith('sign')) return FRONT
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
    case 'sign':
    case 'sign-ceiling':
    case 'sign-wall': {
      // The palette icon shows the front a fresh click would hang — the same default
      // `createModule` builds for a piece placed with no composed boards — and the
      // same empty back, because a thumbnail of the back would be a black tile. A
      // **wall** board has no back at all: the wall is behind it.
      const mount: SignMount = id === 'sign-wall' ? 'wall' : DEFAULT_SIGN_MOUNT
      const boards = makeSignBoards(undefined, station)
      return {
        id,
        type: 'sign',
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        cfg: { mount, front: boards.front, back: signMountSpec(mount).doubleSided ? boards.back : [] },
      }
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
    case 'platform-edge': {
      const line = station.lines[0]
      return {
        id,
        type: 'platform-edge' as const,
        x: 0,
        y: 0,
        z: 0,
        w: 1,
        cfg: {
          name: station.name,
          line: line?.id ?? '1',
          dir: 'up' as const,
          side: 'left' as const,
          psd: 'full' as const,
        },
      }
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

/**
 * How a tile's frame is shaped. A tile is square; a drawing that reuses this pass
 * may be any shape, and the frustum follows the frame rather than assuming a
 * square, so a wide frame is margin and not a stretched piece.
 */
export interface ThumbnailSize {
  width: number
  height: number
}

/**
 * A square-on **side elevation** of a piece, for a section drawing.
 *
 * The rail's icon is a three-quarter view fitted to each piece, which is the wrong
 * picture twice over for a vertical section: a section is flat, and a fitted frame draws
 * a 闸机 and a 商铺 the same size. So an elevation is framed by the piece's own bounds —
 * plus a hair of padding — at **one scale for every piece**, and the picture's bottom
 * edge is the piece's own base, so a sheet has only to put that edge on a floor line.
 *
 * The metres across and up are not returned: they are the frame's own pixel size divided
 * by `pxPerMetre * scale`, which is exactly what a PNG's IHDR already says.
 */
export interface PieceElevations {
  /** The palette ids to draw — a section needs a handful, not all sixty. */
  ids: string[]
  /** Pixels per metre. One figure for the lot, so the drawings compare. */
  pxPerMetre: number
  /** Supersampling. Fixed rather than read from the device, so the scale is exact. */
  scale?: number
  /**
   * How many storeys to stack a **电梯** to.
   *
   * A lift is the one piece the game grows rather than places: `liftModule` serves the
   * floor one storey up, and `liftExtendedUp` moves its `to` up a storey at a time, so a
   * core serving three floors is one lift stacked three deep. A section's shaft is that
   * whole stack, which is why this is asked for rather than left at the single rise a
   * palette icon shows.
   */
  liftStoreys?: number
  /**
   * Ids whose **readable face points away** from the camera, and which are therefore
   * turned through 180° before they are drawn.
   *
   * Most pieces face +y and need nothing. A 货架 does not: its stocked face is the one a
   * shopper walks up to, and a square-on view of the model as it stands shows the plain
   * back panel instead. Turning the piece — which in an elevation is a mirror — puts the
   * shelves and their stock in the picture.
   */
  flip?: string[]
  /**
   * How many cells of platform a **屏蔽门** runs along, for `platform-edge`.
   *
   * One piece covers the whole platform: the screen repeats its header down the run and
   * cuts an opening wherever the line's car doors land, so a single long one is the run
   * a station actually has rather than a row of tiles.
   */
  psdCells?: number
  /**
   * Ids to photograph on the **kit's isometric axes** instead of square-on, each with the
   * corner to take them from. A piece asked for here is drawn after the elevations, and its
   * own framing (and the point its picture is anchored by) is returned beside the pixels —
   * so a sheet can stand it on a floor in its own drawing. See `PieceView`.
   */
  views?: PieceViews
}

/**
 * One piece photographed on the **drawing kit's own axes**, for a sheet that draws a station
 * as a volume (`sheet-13-two-line.mjs`).
 *
 * The side elevations above are the right picture for a *section*: one plane, one scale, every
 * base on the bottom edge. They are the wrong picture for a station drawn in isometric — a
 * square-on escalator dropped into that scene is a flat cut-out standing in a volume. This
 * mode photographs the same piece from the same isometric corner the scene is drawn from, so
 * it needs no angle of its own.
 */
export interface PieceView {
  /**
   * Which drawn corner to photograph from, in the kit's own terms.
   *
   * `iso` is the kit's isometric corner: the picture's right is world **+x** and its up is the
   * kit's own up row, so a piece whose local axes are world axes lands undistorted in a scene
   * drawn with `tools/iso.mjs`. A piece whose local +x runs **against** the kit's — the 扶梯's
   * `from → to`, which runs downhill while a scene's own run climbs the other way — is
   * photographed `iso-flip`: the same corner, mirrored across the picture's own centre, the
   * idiom `sheet-13-two-line.mjs` already uses for a consist.
   */
  from?: 'iso' | 'iso-flip'
  /**
   * Crop the picture to what it actually drew.
   *
   * Off by default, and worth thinking about before turning on: the frame is a rectangle in the
   * **camera's** axes while the picture is drawn in the drawing's, so the two are the same
   * rectangle only at the frame's own proportions. Cropping to the alpha bounds and keeping
   * `metres` at the full frame leaves the picture stated wider than it is and squashes it when
   * a sheet scales it — which is exactly how one version of this drew sheet 13's escalators as
   * a smeared checkerboard. A frame measured on the silhouette (`ISO_PAD`) needs no crop; this
   * is here for a caller that wants the empty margin gone and will use `px` to say so.
   */
  tight?: boolean
}

/** One piece and how to photograph it, as `views` is keyed. */
export interface PieceViews {
  [id: string]: PieceView
}

/**
 * How one `views` picture is laid out — everything a sheet needs to stand it in its own
 * drawing, all of it **measured** rather than assumed.
 *
 * `metres`/`verticalMetres` are the frame in the drawing's own pixels — the same units
 * `tools/iso.mjs` projects with, so one metre of ground is `TW` of them — and the picture's
 * own pixel size over them is the scale it was drawn at. A sheet draws the picture at
 * `metres × its own scale` across and `verticalMetres × its scale` up.
 */
export interface PieceLayout {
  /** The corner the camera stood on — `iso` or `iso-flip`. */
  from: 'iso' | 'iso-flip'
  /** The frame across the picture, in the drawing's own pixels. */
  metres: number
  /** The frame up the picture, in the drawing's own pixels. */
  verticalMetres: number
  /** The picture's pixels, which over the frame above is the scale it was drawn at. */
  px: { width: number; height: number }
  /**
   * Where the piece's **own origin** lands in the picture, as a fraction of it: `u` across
   * from the left, `v` down from the top. This is the point a sheet anchors by, because it is
   * the point the model was built at — a 扶梯's lower landing node, a 楼梯's lower landing
   * cell — so a run reaches exactly the floors the drawing puts it between.
   */
  origin: [number, number]
  /**
   * The pixels actually drawn, as a fraction of the frame: `[u0, v0, u1, v1]`, `u` across from
   * the left and `v` down from the top — the same units as `origin`, so a sheet can put one
   * against the other.
   *
   * A frame is drawn to a rectangle; a piece is not one, and a 扶梯 is the case that matters —
   * its balustrade glass and step band stand outside the box the frame was measured on, so the
   * frame is wider than anything in it. A sheet that scales by the frame draws the piece small
   * and leaves a gap it cannot explain; one that scales by this draws the size the drawing asked
   * for. Its lower-left corner is also where a run's foot is, which is the point a sheet stands a
   * run on the floor by.
   */
  content: [number, number, number, number]
  /** The piece's own bounds in its local metres, `[min, max]` per axis. */
  box: { x: [number, number]; y: [number, number]; z: [number, number] }
}

/** The pictures a `views` pass drew, and how each one is laid out. */
export interface PieceViewResult {
  /** `iso` / `iso-flip` → the piece id it is a picture of. */
  images: Record<string, string>
  /** Piece id → the picture's own layout. */
  layout: Record<string, PieceLayout>
}

const frameOf = (size: number | ThumbnailSize): ThumbnailSize =>
  typeof size === 'number' ? { width: size, height: size } : { width: size.width, height: size.height }

/**
 * The pixels a rendered picture actually covered, and a canvas cropped to them.
 *
 * A `views` frame is transparent — a piece is photographed against nothing, so a sheet can
 * lay it into its own drawing — which is what makes the alpha channel an exact silhouette of
 * what was drawn. The clear alpha is 0 and every drawn pixel is above it, so the bounds are
 * read straight off the channel; a margin of a few pixels is left around the model so its
 * antialiased edge has a pixel to fade into. Returns null for a picture that is entirely
 * clear, which no piece is, so a caller can leave it alone rather than crop it to nothing.
 */
async function cropToAlpha(dataUrl: string): Promise<{ png: string; rect: { x: number; y: number; width: number; height: number } } | null> {
  const canvas = document.createElement('canvas')
  const img = new Image()
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok()
    img.onerror = () => bad(new Error('a piece view would not decode'))
    img.src = dataUrl
  })
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const g = canvas.getContext('2d')
  if (!g) return null
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data
  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  const m = 4
  x0 = Math.max(0, x0 - m)
  y0 = Math.max(0, y0 - m)
  x1 = Math.min(canvas.width - 1, x1 + m)
  y1 = Math.min(canvas.height - 1, y1 + m)
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  out.getContext('2d')?.drawImage(canvas, x0, y0, width, height, 0, 0, width, height)
  return { png: out.toDataURL('image/png'), rect: { x: x0, y: y0, width, height } }
}

/**
 * Render every palette entry once. Throws if WebGL is unavailable.
 *
 * `size` is the frame in **CSS pixels** — a number for the square rail tile, or
 * `{ width, height }` for a drawing that needs another shape. The frames are
 * drawn `devicePixelRatio` times that, which is what gives a card its edges when
 * it is scaled up in a page.
 */
export async function renderModuleThumbnails(
  size: number | ThumbnailSize = 132,
  elevations: PieceElevations | null = null,
): Promise<Record<string, string>> {
  return (await renderModulePieces(size, elevations)).images
}

/**
 * The same pass, reporting **how each picture is laid out** as well as its pixels.
 *
 * A square-on elevation needs only its pixels: the piece's base *is* the picture's bottom
 * edge and its scale is the caller's own `pxPerMetre`. An isometric piece does not — it has
 * no bottom edge, its frame is fitted, and the floor its run starts on is somewhere inside
 * the picture — so the pass that drew it is the only thing that knows where. See
 * `PieceLayout`.
 */
export async function renderModulePieces(
  size: number | ThumbnailSize = 132,
  elevations: PieceElevations | null = null,
): Promise<PieceViewResult> {
  const frame = frameOf(size)
  const out: Record<string, string> = {}
  const layout: Record<string, PieceLayout> = {}
  const views = elevations?.views ?? null
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(elevations ? (elevations.scale ?? 2) : Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(frame.width, frame.height, false)
  // The station's own rig: the rail's icons are meant to look like the pieces they place.
  applyStationRenderer(renderer, { alpha: 0 })

  const scene = new THREE.Scene()
  addStationLights(scene)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  // The world is Z-up (see `SceneRenderer`), so the icon camera must be too —
  // otherwise the model renders lying on its side.
  camera.up.set(0, 0, 1)
  /**
   * The camera a `views` piece is photographed with, kept apart from the elevation camera:
   * the two are framed on different axes, and each draw states its own frustum in full. It
   * is reused across the pass rather than minted per piece, because a camera holds no GPU
   * resources and the frustum is restated before every render anyway.
   */
  const virtual = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000)
  virtual.up.set(0, 0, 1)
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
  // `signFace` mints a fresh wrapper material per call around a cached texture;
  // `disposeObject` keeps materials, so the wrappers would survive the per-tile
  // teardown below. Tracked here and released with the pass.
  const signWrappers: THREE.Material[] = []
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
      const wrapper = litPanelMaterial(t)
      signWrappers.push(wrapper)
      return wrapper
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
    /**
     * Photograph one built piece on the drawing kit's axes, and record exactly where it landed.
     *
     * Three things make this an *isometric* view rather than a three-quarter icon, and each of
     * them was a bug before it was a rule:
     *
     *   * the **frame** is measured on the piece's silhouette taken into the camera's own space
     *     (`localSilhouette`), not on the model's axis-aligned box — a rotated truss's box is
     *     half again as tall as anything drawn, and framing it draws the piece small;
     *   * the **origin** is computed from the camera's own axes after `lookAt` has derived them,
     *     not from the kit's rows, which `lookAt` does not agree with — assuming they matched put
     *     the 扶梯 and the 楼梯 anywhere but where the drawing wanted them;
     *   * the **content** is measured off the alpha channel, because that is the one place the
     *     picture's own extent is stated in the frame's units rather than the camera's.
     *
     * What a sheet gets back is therefore the three numbers it needs to lay the picture in: how
     * big the frame is, where in it the piece is, and where the model's own origin landed.
     */
    const drawIsoView = async (id: string, view: PieceView, group: THREE.Object3D): Promise<void> => {
      scene.add(group)
      const box = objectBox(group)
      /**
       * The camera, and the two axes this picture is *about*.
       *
       * `right` and `up` are the kit's rows — `(x − y)` across and `(x + y)·TH − z·ZU` up —
       * normalised, and `look` completes them. They are what the piece is **framed against**,
       * because a drawing is measured along them. They are not the camera's own basis: `lookAt`
       * re-derives that against the world's up, and the two are genuinely different frames.
       *
       * The camera is what renders, so the camera is what the origin has to be read from — see
       * `camRight`/`camUp` below. These two rows are only used to say *where to put the
       * frustum*, and no rotation can get that wrong: a symmetric frustum about a point is the
       * same point whatever basis it is stated in.
       */
      const right = ISO_RIGHT.clone()
      const up = ISO_UP.clone()
      const look = new THREE.Vector3().crossVectors(right, up).normalize()
      const centre = box.getCenter(new THREE.Vector3())
      // Frame on a camera first, so the silhouette can be measured in its own space.
      virtual.up.copy(up)
      virtual.position.copy(centre).addScaledVector(look, -400)
      virtual.lookAt(centre)
      virtual.updateMatrixWorld(true)
      const sil = localSilhouette(group, virtual)
      /**
       * The frame, in the projection's own pixels — the unit a sheet draws in.
       *
       * The silhouette is stated in the camera's local `x`, and a local `x` is the frame's
       * across axis, so the two extents are the silhouette's own, padded. Nothing has to be
       * converted: `metres` is then the frame **as the picture's pixels already measure it**,
       * which is what makes a sheet's placement arithmetic rather than a measurement.
       */
      const halfW = Math.max(0.5, ((sil.x[1] - sil.x[0]) / 2) * ISO_PAD)
      const halfH = Math.max(0.5, ((sil.y[1] - sil.y[0]) / 2) * ISO_PAD)
      const pxPerKit = PX_PER_KIT
      const wPx = Math.max(16, Math.round(halfW * 2 * pxPerKit))
      const hPx = Math.max(16, Math.round(halfH * 2 * pxPerKit))
      renderer.setSize(wPx, hPx, false)
      // The point the frustum is centred on, in the camera's own space: the middle of the
      // silhouette, in the metres `halfW`/`halfH` are stated in.
      const cx = (sil.x[0] + sil.x[1]) / 2
      const cy = (sil.y[0] + sil.y[1]) / 2
      virtual.position.copy(centre).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(look, -400)
      virtual.lookAt(centre.clone().addScaledVector(right, cx).addScaledVector(up, cy))
      virtual.left = -halfW
      virtual.right = halfW
      virtual.top = halfH
      virtual.bottom = -halfH
      virtual.near = 0.01
      virtual.far = 2000
      virtual.updateProjectionMatrix()
      virtual.updateMatrixWorld(true)
      renderer.render(scene, virtual)
      let png = renderer.domElement.toDataURL('image/png')
      let px = { width: wPx, height: hPx }
      /**
       * Where the model's own origin falls in that frame.
       *
       * The origin is the world point the piece was built at — a 扶梯's lower landing node, a
       * 楼梯's lower landing cell — taken into the same space the silhouette was measured in
       * and stated as a fraction of the frame. It is the one point a sheet anchors by, so it is
       * computed rather than assumed. The picture's top-left is its own corner and the frame's
       * **down** is against `up`, which is the sign the fraction carries.
       */
      // The camera's own two axes in world space — its matrix's first two columns. Taken from
      // the matrix rather than assumed, because `lookAt` derives them and they are not the
      // kit's rows.
      const cam = virtual.matrixWorld.elements
      const camRight = new THREE.Vector3(cam[0], cam[1], cam[2])
      const camUp = new THREE.Vector3(cam[4], cam[5], cam[6])
      const fromCentre = new THREE.Vector3().copy(centre).multiplyScalar(-1)
      let frameMetres = 2 * halfW
      let frameVertical = 2 * halfH
      let originX = 0.5 + fromCentre.dot(camRight) / (2 * halfW)
      let originY = 0.5 + fromCentre.dot(camUp) / (2 * halfH)
      /**
       * Where in the frame the piece actually is, as fractions of it — **measured**, not
       * derived.
       *
       * This has to be the alpha bounds, and it has to be the alpha bounds even when the caller
       * did not ask for a crop. The silhouette is stated in the **camera's** own units, and
       * turning those into a fraction of the frame means undoing the rotation `lookAt` puts
       * between the camera's axes and the drawing's — a correction that is easy to get wrong and
       * hard to notice, since a piece drawn a little too small still lands on the right floor.
       * The pixels have no such problem.
       */
      const drawn = await cropToAlpha(png)
      /**
       * The crop, in **frame pixels** — not in the pixels of the cropped picture.
       *
       * `wPx`/`hPx` are the CSS frame, and the canvas `toDataURL` hands back is that frame
       * `scale` times over, so a crop's own pixel coordinates are in the rendered picture while
       * everything a sheet reads — `metres`, `verticalMetres`, `origin` — is in the frame. The
       * fractions are taken against the **rendered** size for that reason, which is also why
       * `px` stays the frame's rather than the crop's: it is what says how many pixels the frame
       * has, and therefore how big a metre of it is.
       */
      const renderedW = Math.max(1, Math.round(wPx * (elevations?.scale ?? 2)))
      const renderedH = Math.max(1, Math.round(hPx * (elevations?.scale ?? 2)))
      const content: [number, number, number, number] = drawn
        ? [
            drawn.rect.x / renderedW,
            drawn.rect.y / renderedH,
            (drawn.rect.x + drawn.rect.width) / renderedW,
            (drawn.rect.y + drawn.rect.height) / renderedH,
          ]
        : [0, 0, 1, 1]
      if (view.tight && drawn) {
        // Cropping **moves the anchor, not the drawing**. The frame is still the one the frustum
        // drew — `metres` is what a sheet scales the picture by, and the picture is still the
        // whole frame's worth of metres, with only the window that held something kept. So the
        // origin keeps the pixel it had, as a fraction of the smaller window, and the frame's own
        // size does not change at all.
        originX = (originX * wPx - drawn.rect.x) / drawn.rect.width
        originY = (originY * hPx - drawn.rect.y) / drawn.rect.height
        png = drawn.png
      }
      /**
       * Keyed by the **piece**, not by the corner it was taken from.
       *
       * This was `out[view.from ?? 'iso']`, and the two names are shared by every piece shot
       * from that corner — so a pass with more than one piece per corner handed back one picture
       * under that name and every other piece inherited it. Two pieces happened to sit on the two
       * corners, which is why the bug lived: sheet 13's 扶梯 and 楼梯 are one of each. The moment
       * sheet 01 asked for eleven devices, six of them came back as the *last* `iso` render and
       * five as the last `iso-flip` one, each still wearing its own correct frame — a picture and
       * a layout that disagreed, which no sheet can survive. `view.from` stays on the layout,
       * where a sheet reads it to decide whether to mirror the picture it has.
       */
      out[id] = png
      /**
       * The piece's own bounds, in its own metres — the model's **world box**, measured from the
       * geometry that was built (`objectBox`), not reconstructed from the silhouette.
       *
       * It used to be the silhouette rectangle's four corners taken back into the world along
       * the two axes, which is a rectangle in the *camera's* plane and not the piece's extent at
       * all: a 扶梯 came back `z = 0.92 … 5.86`, i.e. floating nearly a metre above the floor its
       * own origin sits on, and no sheet could use that for anything. What a sheet wants here is
       * where the model actually is — its floor, its head, and how long it is — and this is it.
       */
      layout[id] = {
        from: view.from ?? 'iso',
        metres: frameMetres,
        verticalMetres: frameVertical,
        px,
        origin: [originX, originY],
        content,
        box: {
          x: [box.min.x, box.max.x],
          y: [box.min.y, box.max.y],
          z: [box.min.z, box.max.z],
        },
      }
    }

    /**
     * The palette rows a pass asked for, each with the label it is drawn under.
     *
     * A pass names ids, and an id is either a catalogue row or one of the three **synthetic**
     * rows the palette deliberately has no entry for — a 电梯's cabin on its own, its shaft on
     * its own, a 屏蔽门 along a platform edge — which is why the list is built from the ids
     * rather than filtered out of the catalogue: a synthetic id must not be dropped, and a
     * catalogue id must not be drawn twice when a pass asks for it once as an elevation and
     * once as a view.
     */
    const rowsFor = (ids: readonly string[]): Array<{ id: string; label: string }> => {
      const synthetic: Record<string, string> = {
        'lift-car': '电梯轿厢',
        'lift-shaft': '电梯井',
        'platform-edge': '屏蔽门',
      }
      const seen = new Set<string>()
      const rows: Array<{ id: string; label: string }> = []
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const row = MODULE_OPTIONS.find((o) => o.id === id)
        if (row) rows.push({ id: row.id, label: row.label })
        else if (synthetic[id]) rows.push({ id, label: synthetic[id] })
      }
      return rows
    }
    const wanted = elevations
      ? rowsFor([...elevations.ids, ...Object.keys(elevations.views ?? {})])
      : rowsFor(MODULE_OPTIONS.map((o) => o.id))
    for (const opt of wanted) {
      // A `lift-car` is sampled as the lift it is a part of; everything else by its own id.
      let mod = sampleModule(opt.id === 'lift-car' || opt.id === 'lift-shaft' ? 'lift' : opt.id, station)
      if (mod && mod.type === 'platform-edge' && elevations?.psdCells) mod = { ...mod, w: elevations.psdCells }
      if (!mod) continue
      // A 电梯 is stacked to the storeys the caller asked for before anything is measured:
      // its shaft, not its rise, is what a section draws.
      if ((opt.id === 'lift' || opt.id === 'lift-shaft') && (elevations?.liftStoreys ?? 1) > 1 && mod.type === 'lift') {
        for (let i = 1; i < (elevations as PieceElevations).liftStoreys!; i++) mod = liftExtendedUp(mod)
      }
      let group = buildModule(mod, ctx)
      if (!group) continue

      // A piece asked for as a `view` is photographed on the **drawing kit's own axes**, and
      // is finished with here: the elevation path below quarter-turns a long piece and frames
      // it on a flat box, neither of which means anything in an isometric scene. A piece may
      // be asked for both ways, so the two are separate passes over the same built group.
      const view = views?.[opt.id]
      if (view) {
        await drawIsoView(opt.id, view, group)
        scene.remove(group)
        disposeObject(group)
        continue
      }

      if (elevations) {
        // A section is one plane, so every piece in it is seen along the **same** axis —
        // and a piece whose run lies along the viewing axis would come out end-on. So a
        // piece built the long way round is quarter-turned to lie across the page: the
        // section is drawn as a station would be laid out if the escalator ran left to
        // right, not into the paper.
        let box = objectBox(group)
        // The shaft and its cabin, separately: `LiftModel` leaves the cabin in
        // `userData.liftCabin` with its origin on the cabin floor and bakes it in at the
        // shaft's foot. A sheet that wants to *travel* a cabin — rather than draw one —
        // needs the two apart, so `lift-shaft` is the shaft without it and `lift-car` is
        // the cabin on its own.
        if (opt.id === 'lift-car' || opt.id === 'lift-shaft') {
          const cabin = (group as THREE.Group).userData?.liftCabin as THREE.Group | undefined
          if (!cabin) continue
          group.remove(cabin)
          if (opt.id === 'lift-car') {
            disposeObject(group)
            group = cabin
          } else {
            disposeObject(cabin)
          }
          box = objectBox(group)
        }
        const runAlongY = box.max.y - box.min.y > box.max.x - box.min.x
        if (runAlongY) {
          scene.remove(group)
          disposeObject(group)
          // A 扶梯 and a 楼梯 carry their run as a `from`/`to` pair rather than a quarter
          // turn, so turning *them* means swapping the pair's x and y — setting `rot` on
          // one of them is a property the model never reads, which is how the first
          // attempt at this drew an escalator end-on. A 楼梯 keeps a pair per **flight**,
          // and draws those, so every flight is swapped and not just the module's own.
          const swap = (v: { x: number; y: number; z: number }) => ({ ...v, x: v.y, y: v.x })
          const turned =
            'from' in mod && 'to' in mod
              ? {
                  ...mod,
                  from: swap(mod.from),
                  to: swap(mod.to),
                  cfg: {
                    ...(mod as { cfg?: Record<string, unknown> }).cfg,
                    ...('flights' in ((mod as { cfg?: object }).cfg ?? {})
                      ? {
                          flights: (
                            (mod as unknown as { cfg: { flights: Array<{ from: object; to: object }> } }).cfg.flights
                          ).map((f) => ({ ...f, from: swap(f.from as never), to: swap(f.to as never) })),
                        }
                      : {}),
                  },
                }
              : { ...mod, rot: ((mod.rot ?? 0) + 1) % 4 }
          group = buildModule(turned as typeof mod, ctx)
          if (!group) continue
          box = objectBox(group)
        }
        scene.add(group)
        // Square on the piece's +y face, with the frustum *on* the piece's own bounds:
        // nothing is fitted and nothing is cropped. The picture's bottom edge is the
        // piece's own base, so a sheet has only to put that edge on a floor line.
        const px = elevations.pxPerMetre
        const pad = 0.12
        const x0 = box.min.x - pad
        const x1 = box.max.x + pad
        // The picture's bottom edge is the piece's **base**, which is where the game stands
        // it: a 扶梯's lowest drawn point is its lower landing, a 电梯's is the foot of its
        // shaft. Both carry a little more than one storey above the floor they arrive at —
        // an escalator's balustrade, a lift's overrun — and that is left in, because the
        // game draws it and a shaft's headroom is real.
        const z0 = box.min.z
        const z1 = box.max.z + pad
        const wPx = Math.max(8, Math.round((x1 - x0) * px))
        const hPx = Math.max(8, Math.round((z1 - z0) * px))
        renderer.setSize(wPx, hPx, false)
        const cx = (x0 + x1) / 2
        const cz = (z0 + z1) / 2
        camera.left = -(x1 - x0) / 2
        camera.right = (x1 - x0) / 2
        camera.top = (z1 - z0) / 2
        camera.bottom = -(z1 - z0) / 2
        camera.up.set(0, 0, 1)
        // From +y looking toward −y, so the picture's right is world +x and a piece cannot
        // come out mirrored. `y` is the viewing axis, so the box's own y only has to hold
        // the piece between the near and far planes.
        // A piece whose readable face points away is turned through 180° about the
        // vertical axis, which in a square-on elevation is a mirror. (Moving the camera to
        // the far side instead changed nothing: these models' screens are double-sided
        // planes and read from behind as well as in front.)
        // The pieces whose readable face points at **-y** — a 售货机's display, a
        // 售票机's screen and sign, a 货架's stock — are shot from that side. The camera
        // is the thing that moves: reflecting the model left-to-right cannot turn it
        // round, which is why the sheet went on showing their backs.
        const fromBack = elevations.flip?.includes(opt.id) ?? false
        camera.position.set(cx, fromBack ? box.min.y - 120 : box.max.y + 120, cz)
        camera.near = 0.01
        camera.far = 400
        camera.lookAt(new THREE.Vector3(cx, (box.min.y + box.max.y) / 2, cz))
        camera.updateProjectionMatrix()
      } else {
      scene.add(group)
      const sphere = objectBox(group).getBoundingSphere(new THREE.Sphere())
      const r = Math.max(0.35, sphere.radius)
      const half = r * 1.22
      // The frustum follows the **frame's** shape. A square tile is the same
      // arithmetic either way; a wide frame is then margin around a piece of the
      // same size, rather than the same frustum squeezed into it — which is what
      // stretches a model sideways the moment a caller asks for a non-square icon.
      const aspect = frame.height > 0 ? frame.width / frame.height : 1
      camera.left = -half * aspect
      camera.right = half * aspect
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
      }

      renderer.render(scene, camera)
      out[opt.id] = renderer.domElement.toDataURL('image/png')

      scene.remove(group)
      disposeObject(group)
    }
  } finally {
    disposeModelMaterials(mats)
    ads.dispose()
    lineMaps.dispose()
    // The 站名 ink and the 线网图 boards are minted for the tiles alone: nothing in
    // the scene shares them, so they go with the pass (each wraps a canvas of its
    // own, and the pass is one-shot for the session).
    for (const mat of faceCache.values()) {
      const map = (mat as THREE.MeshBasicMaterial).map
      if (map) map.dispose()
      mat.dispose()
    }
    // The 电视/指示牌 plate textures cached for the pass, plus the per-call wrapper
    // materials around them (which `disposeObject` keeps, so the per-tile teardown
    // above never frees them).
    for (const m of signWrappers) m.dispose()
    for (const t of plateCache.values()) t.dispose()
    for (const m of finishes.finishCache.values()) {
      m.map?.dispose()
      m.dispose()
    }
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return { images: out, layout }
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
