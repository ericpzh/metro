// A rendering pass for concept sheet 11, on demand from a page.
//
// Sheet 05 gives the rolling stock's numbers; sheet 11 is the shape, and the only
// honest way to draw the shape is to let the game build it: every picture here comes
// out of `buildTrain` — the very consist the game runs down a platform — with the
// model kit's own materials (`render/models.ts`) and the same light rig the build
// rail's icons are shot with.
//
// So the rounded body, the glazing band, the livery broken at every doorway, the
// sliding leaves, the lining behind the seats and the two bogies are the ones a
// player watches a crowd board. A car drawn again in SVG would be a fourth thing to
// keep in step with `sim/stock.ts`, `doorCentres` and `CabModel`.
//
// The **table** is read from `sim/stock.ts` and returned beside the pixels — the
// classes, their dimensions, their door cadence and their capacity, plus the cabin
// the sim seats riders in — so the sheet quotes the simulation's own numbers and a
// retuned car arrives on it by itself.
//
// `tools/render-train-cards.mjs` drives this headlessly: it boots the built game at
// `?capture-trains` and embeds what comes back in `art/11-rolling-stock-3d.svg`.

import * as THREE from 'three'
import { createModelMaterials, disposeModelMaterials, disposeObject, type ModelMaterials } from '../render/models.ts'
import { buildTrain, setDoors } from '../render/models/pieces/TrainModel.ts'
import {
  CABIN_FLOOR_Z,
  CABIN_HALF_W,
  CABIN_MAX_ROWS,
  CABIN_ROW_PITCH,
  DOOR_END_INSET,
  DOOR_HEAD_Z,
  DOOR_SILL_Z,
  STOCK,
  STOCK_CLASSES,
  doorCentres,
  trainLength,
  trainRatedCapacity,
} from '../sim/stock.ts'
import { lineColourFor } from '../data/line-colours.ts'
import type { StockClass } from '../sim/stock.ts'

/**
 * The livery each class wears.
 *
 * A consist's colour *is* its line's colour, and a line is born wearing the real
 * Guangzhou sign colour for its number (`data/line-colours.ts` — the operator's own
 * values). The four classes are put on four different lines so their shapes can be
 * told apart at a glance; **which line a class wears here is this pass's own choice,
 * not a claim about which line runs which car** — in the game a player picks the
 * colour, and the 车型 chips are separate from it. The four are picked for contrast
 * (yellow / blue / green / red) as much as anything. L wears 5号线 because that is the
 * line the shipped demo station runs, and the consist it runs is the L one.
 */
const LIVERY_LINE: Record<StockClass, string> = { A: '1', B: '2', C: '4', L: '5' }

/** The colour a class is built in. */
function liveryFor(cls: StockClass): string {
  return lineColourFor(LIVERY_LINE[cls])
}

/** Which part of a consist a frame holds. */
type Span = [number, number] | 'car' | 'nose'

/**
 * A **true elevation**, as opposed to the three-quarter views sheet 11 reads shapes from.
 *
 * The camera sits square on one axis, and the pass is orthographic (`OrthographicCamera`
 * below), so the picture is a drawing of the car: pixel distances are metres, and a
 * dimension line drawn on the sheet lands where the dimension is.
 */
type Elevation = 'front' | 'side'

/** The direction a car is seen from for its shape: the side, plus a little of the end. */
const CAR = new THREE.Vector3(1, -1.35, 0.62).normalize()
/** The whole consist, foreshortened enough that 117 m still reads in one frame. */
const CONSIST = new THREE.Vector3(1, -0.85, 0.42).normalize()
/** The nose, close: the cab's own re-skin, its lamps and its coupler. */
const NOSE = new THREE.Vector3(1, -0.85, 0.4).normalize()
/** Square on the car's end — the frontal elevation, which is where width and height read. */
const FRONT_ON = new THREE.Vector3(1, 0, 0)
/** Square on the car's flank — the side elevation, which is where the door cadence reads. */
const SIDE_ON = new THREE.Vector3(0, -1, 0)

/**
 * The world box every elevation is framed in, in metres — **the same box for every
 * class**, which is what makes the four comparable: at one scale a 3.0 m car is
 * visibly wider than a 2.6 m one, and a 22 m car visibly longer than a 16.8 m one.
 * A fitted box per class would draw them all the same size and the sheet would be
 * telling a lie with its layout.
 */
const ELEV_Z: [number, number] = [-0.35, 4.05]
const ELEV_HALF_Y = 1.7
/** Half a 22 m car: the longest body, so the longest one exactly fills its frame. */
const ELEV_HALF_X = 11
/** Pixels per metre the elevations are drawn at, so a frame's shape follows its box. */
const ELEV_PX_PER_M = 50

/** One consist to build, and how to look at it. */
interface TrainScene {
  stock: StockClass
  cars: number
  doorsOpen: boolean
  from: THREE.Vector3
  span: Span
  /** Set for a true elevation, which frames a fixed box instead of the built geometry. */
  elevation?: Elevation
}

/**
 * The pictures the sheet carries, in the order it reads them.
 *
 * `cars: 2` for a specimen rather than one: a one-car consist is reachable (the
 * LineCard's 编组 slider runs 1–8) but it hangs a cab on **both** ends of the same
 * car, which is not the shape a reader is being shown. Two cars give one cab end and
 * one gangway, and the frame is then cut to the leading car.
 */
const SHOW: ReadonlyArray<{ id: string; label: string; note: string; width: number; height: number; scene: TrainScene }> = [
  ...STOCK_CLASSES.map((cls) => ({
    id: `car-${cls}`,
    label: `${cls} 型`,
    note: `${STOCK[cls].length.toFixed(1)} 米 × ${STOCK[cls].width.toFixed(1)} 米，每侧 ${STOCK[cls].doorsPerSide} 门`,
    width: 470,
    height: 200,
    scene: { stock: cls, cars: 2, doorsOpen: false, from: CAR, span: 'car' as Span },
  })),
  {
    id: 'open',
    label: '开着门',
    note: '两扇门叶滑开，露出车厢里面',
    width: 470,
    height: 200,
    scene: { stock: 'B', cars: 2, doorsOpen: true, from: CAR, span: 'car' as Span },
  },
  {
    id: 'nose',
    label: '车头',
    note: '车头不是加出来的一节：它是末节车厢最后 2 米的重新蒙皮，只有灯分前后',
    width: 420,
    height: 250,
    scene: { stock: 'B', cars: 2, doorsOpen: false, from: NOSE, span: 'nose' as Span },
  },
  {
    id: 'consist',
    label: '整列车',
    note: '动物园自己那一列：L 型 6 节，5 号线涂装',
    width: 1504,
    height: 300,
    scene: { stock: 'L', cars: 6, doorsOpen: false, from: CONSIST, span: 'consist' as Span },
  },
  // The two true elevations, one per class: the frontal one is where width and height
  // read, the side one is where the door cadence and the body's length read. Both are
  // framed in the same box for every class, so the four can be laid side by side.
  ...STOCK_CLASSES.map((cls) => ({
    id: `front-${cls}`,
    label: `${cls} 型正面`,
    note: '正对车头看：宽和高',
    width: Math.round(2 * ELEV_HALF_Y * ELEV_PX_PER_M),
    height: Math.round((ELEV_Z[1] - ELEV_Z[0]) * ELEV_PX_PER_M),
    scene: { stock: cls, cars: 2, doorsOpen: false, from: FRONT_ON, span: 'car' as Span, elevation: 'front' as Elevation },
  })),
  ...STOCK_CLASSES.map((cls) => ({
    id: `side-${cls}`,
    label: `${cls} 型侧面`,
    note: '正对车身看：长度和门的节奏',
    width: Math.round(2 * ELEV_HALF_X * ELEV_PX_PER_M),
    height: Math.round((ELEV_Z[1] - ELEV_Z[0]) * ELEV_PX_PER_M),
    scene: { stock: cls, cars: 2, doorsOpen: false, from: SIDE_ON, span: 'car' as Span, elevation: 'side' as Elevation },
  })),
]

export interface TrainFrame {
  id: string
  width: number
  height: number
  background?: string
}

export interface TrainPiece {
  id: string
  label: string
  note: string
  /**
   * The framed box's width in metres, for the frames drawn as a true elevation, or
   * null for a fitted view. A sheet divides a frame's own pixels by it to get the
   * drawing's scale, which is what lets a dimension line land where the dimension is.
   */
  metres: number | null
}

export interface CapturedTrain {
  id: string
  width: number
  height: number
  png: string
  /** The box that was framed and the frustum it was framed in, in metres. */
  debug: { box: number[]; mx: number; my: number; halfW: number; halfH: number }
}

/** One car class, as `sim/stock.ts` defines it. */
export interface StockRow {
  cls: string
  width: number
  length: number
  height: number
  doorsPerSide: number
  doorWidth: number
  crushPerCar: number
  ratedPerCar: number
  consist: [number, number]
  power: string
  /** Metres between two doorways of one car, read off `doorCentres` itself. */
  doorPitch: number | null
  /** A six-car consist's length and rated capacity, for the class's own line. */
  sixCarLength: number
  sixCarRated: number
}

/**
 * The rolling stock, in the classification's own order.
 *
 * Read straight from `sim/stock.ts`, so the sheet's table is the table the spawn, the
 * platform screen doors and the timetable all read. `doorPitch` is taken from
 * `doorCentres` rather than recomputed, because that list — not a formula — is what
 * the screen doors are cut to (§1.13).
 */
export function stockTable(): StockRow[] {
  return STOCK_CLASSES.map((cls) => {
    const s = STOCK[cls]
    const centres = doorCentres({ stock: cls, cars: 6 })
    const pitch = centres.length > 1 ? Math.round((centres[1] - centres[0]) * 100) / 100 : null
    return {
      cls,
      width: s.width,
      length: s.length,
      height: s.height,
      doorsPerSide: s.doorsPerSide,
      doorWidth: s.doorWidth,
      crushPerCar: s.crushPerCar,
      ratedPerCar: s.ratedPerCar,
      consist: s.consist,
      power: s.power === 'catenary' ? '接触网' : '第三轨',
      doorPitch: pitch,
      sixCarLength: trainLength({ stock: cls, cars: 6 }),
      sixCarRated: trainRatedCapacity({ stock: cls, cars: 6 }),
    }
  })
}

/**
 * The cabin both the model and the simulation are cut from.
 *
 * `cabinSlot` in `sim/stock.ts` seats a rider in this box and `TrainModel` skins it,
 * which is the contract that lets a passenger be *watched* riding inside a consist;
 * the sheet prints the numbers so a reader can see the two are one shape.
 */
export function cabinFacts(): Record<string, number> {
  return {
    doorSill: DOOR_SILL_Z,
    doorHead: DOOR_HEAD_Z,
    doorClear: Math.round((DOOR_HEAD_Z - DOOR_SILL_Z) * 100) / 100,
    floor: CABIN_FLOOR_Z,
    halfWidth: CABIN_HALF_W,
    rowPitch: CABIN_ROW_PITCH,
    maxRows: CABIN_MAX_ROWS,
    endInset: DOOR_END_INSET,
  }
}

/**
 * The livery each class is built in, for the sheet to print beside it.
 *
 * `line` is the line whose sign colour it is, so a reader can check the colour against
 * `data/line-colours.ts` rather than take it on trust.
 */
export function liveryTable(): Array<{ cls: string; line: string; colour: string }> {
  return STOCK_CLASSES.map((cls) => ({ cls, line: LIVERY_LINE[cls], colour: liveryFor(cls) }))
}

/** The sheet's frames and the text each picture wears. */
export function trainPieces(background = '#0d141d'): { frames: TrainFrame[]; pieces: TrainPiece[] } {
  const frames: TrainFrame[] = []
  const pieces: TrainPiece[] = []
  for (const show of SHOW) {
    frames.push({ id: show.id, width: show.width, height: show.height, background })
    const metres =
      show.scene.elevation === 'front'
        ? 2 * ELEV_HALF_Y
        : show.scene.elevation === 'side'
          ? 2 * ELEV_HALF_X
          : null
    pieces.push({ id: show.id, label: show.label, note: show.note, metres })
  }
  return { frames, pieces }
}

/* ------------------------------------------------------------------ the pass */

/** The world box a scene's frame holds, in metres along the consist. */
function spanOf(scene: TrainScene): [number, number] {
  const s = STOCK[scene.stock]
  const half = (s.length * scene.cars) / 2
  if (Array.isArray(scene.span)) return scene.span
  // `buildTrain` puts the **leading** cab at +x and the trailing one at −x, so the car
  // worth framing is the one at the far end of the run, not the near one.
  if (scene.span === 'car') return [half - s.length, half]
  if (scene.span === 'nose') return [half - Math.min(6, s.length / 3), half]
  return [-half, half]
}

/**
 * Render every requested frame, in the order asked.
 *
 * Each picture is its own render: a consist is a few hundred meshes, the materials are
 * minted once and shared, and a canvas per frame only has to be resized. Frames come
 * back at **twice** the size asked for, so the sheet embeds a 2× image in a 1× box.
 */
export async function captureTrains(
  frames: TrainFrame[],
  onProgress?: (done: number, total: number) => void,
): Promise<CapturedTrain[]> {
  const out: CapturedTrain[] = []
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(2)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02

  // The same rig the build rail's icons and the block sheet are shot with.
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

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000)
  camera.up.set(0, 0, 1)

  const mats: ModelMaterials = createModelMaterials()
  const byId = new Map(SHOW.map((s) => [s.id, s]))
  let done = 0

  try {
    for (const frame of frames) {
      const show = byId.get(frame.id)
      if (!show) continue
      const s = STOCK[show.scene.stock]
      const group = buildTrain(mats, {
        x: 0,
        y: 0,
        z: 0,
        cars: show.scene.cars,
        stock: show.scene.stock,
        doorsOpen: show.scene.doorsOpen,
        colour: liveryFor(show.scene.stock),
        dirSign: 1,
        yaw: 0,
      })
      // The leaves are placed by `setDoors`, which the live scene drives from the
      // dwell's own progress — the pose's `doorsOpen` is a hint, not a control.
      setDoors(group, show.scene.doorsOpen ? 1 : 0)
      scene.add(group)

      renderer.setSize(frame.width, frame.height, false)
      renderer.setClearColor(frame.background ?? '#0d141d', 1)

      // Frame the part of the consist the picture is of. A true elevation frames a
      // **fixed box** instead, identical for every class, so the four share one scale.
      // Otherwise the box is cut from the span in metres and intersected with the built
      // geometry, so a single car fills its frame instead of shrinking into a 30 : 1
      // silhouette.
      const [x0, x1] = spanOf(show.scene)
      let box = new THREE.Box3(
        new THREE.Vector3(x0, -s.width / 2 - 0.2, -0.2),
        new THREE.Vector3(x1, s.width / 2 + 0.2, s.height + 0.6),
      )
      if (show.scene.elevation === 'front') {
        box = new THREE.Box3(
          new THREE.Vector3(x0, -ELEV_HALF_Y, ELEV_Z[0]),
          new THREE.Vector3(x1, ELEV_HALF_Y, ELEV_Z[1]),
        )
      } else if (show.scene.elevation === 'side') {
        const centre = (x0 + x1) / 2
        box = new THREE.Box3(
          new THREE.Vector3(centre - ELEV_HALF_X, -ELEV_HALF_Y, ELEV_Z[0]),
          new THREE.Vector3(centre + ELEV_HALF_X, ELEV_HALF_Y, ELEV_Z[1]),
        )
      } else {
        const built = objectBox(group)
        if (!built.isEmpty()) box.intersect(built)
      }

      const aim = box.getCenter(new THREE.Vector3())
      camera.position.copy(aim).addScaledVector(show.scene.from, 200)
      camera.lookAt(aim)
      camera.updateMatrixWorld(true)
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

      const aspect = frame.height > 0 ? frame.width / frame.height : 1
      let mx = 0
      let my = 0
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(camera.matrixWorldInverse)
        mx = Math.max(mx, Math.abs(v.x))
        my = Math.max(my, Math.abs(v.y))
      }
      const PAD = 1.05
      const halfH = Math.max(my, mx / aspect) * PAD
      const halfW = halfH * aspect
      camera.left = -halfW
      camera.right = halfW
      camera.top = halfH
      camera.bottom = -halfH
      camera.near = 0.01
      camera.far = 600
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld(true)

      renderer.render(scene, camera)
      out.push({
        id: frame.id,
        width: frame.width,
        height: frame.height,
        png: renderer.domElement.toDataURL('image/png'),
        debug: {
          box: [...box.min.toArray(), ...box.max.toArray()].map((v) => Math.round(v * 10) / 10),
          mx: Math.round(mx * 10) / 10,
          my: Math.round(my * 10) / 10,
          halfW: Math.round(halfW * 10) / 10,
          halfH: Math.round(halfH * 10) / 10,
        },
      })

      scene.remove(group)
      // The livery is minted per build and the group owns it; everything else on a
      // train is the shared kit, which `disposeObject` deliberately keeps.
      for (const m of (group.userData.ownedMats as THREE.Material[] | undefined) ?? []) m.dispose()
      disposeObject(group)
      onProgress?.(++done, frames.length)
    }
  } finally {
    disposeModelMaterials(mats)
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return out
}

/**
 * World-space bounds that include a mesh's own geometry, as `objectBox` in
 * `moduleThumbnails.ts` measures a piece — one helper, so the two passes frame a
 * model the same way.
 */
function objectBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const geo = mesh.geometry
    if (!geo) return
    if (!geo.boundingBox) geo.computeBoundingBox()
    if (geo.boundingBox) box.union(geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
  })
  return box
}
