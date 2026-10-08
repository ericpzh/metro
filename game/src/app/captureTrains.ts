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
import { TrackModel } from '../render/models/pieces/TrackModel.ts'
import type { ModuleContext } from '../render/models/PieceBuilder.ts'
import { addStationLights, applyStationRenderer } from '../render/scene/lightRig.ts'
import { RAIL_BED_DEPTH, makeTrack } from '../build/rail.ts'
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
type Elevation = 'front' | 'side' | 'plan' | 'iso'

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
 * Straight down, from **above** — the plan, which is where a platform and its queue
 * lanes are laid out. `from` is the camera's offset from what it looks at, so +z here
 * is over the roof; −z would be a view of the underframe.
 */
const PLAN_ON = new THREE.Vector3(0, 0, 1)

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
/**
 * Half a two-car consist plus its gangway, for the plan: the platform sheet needs the
 * whole train it draws on the track, not one car of it.
 */
const PLAN_HALF_X = 21
/** Pixels per metre the elevations are drawn at, so a frame's shape follows its box. */
/**
 * The drawing kit's screen axes — `tools/iso.mjs` projects with
 * `px = (x - y) * TW`, `py = (x + y) * TH - z * ZU`.
 *
 * Its screen is **not** a true orthographic view: a metre of height is `ZU` pixels where a
 * metre on the ground plane is `|(TW, TW, -ZU)|`. That matters because an orthographic
 * camera has square pixels, so the render is made on the kit's axes at the height scale and
 * the sheet stretches it back out sideways by `ISO_STRETCH`.
 */
const ISO_TW = 30, ISO_TH = ISO_TW / Math.sqrt(3), ISO_ZU = Math.hypot(ISO_TW, ISO_TH)
// `py = (x + y) * TH - z * ZU`, so the screen's *down* row is `(TH, TH, -ZU)` — this was
// built from TW, which tilted the rendering camera off the kit's by the difference and is
// the reason the picture then needed a sideways squash to sit in a scene.
const ISO_DOWN = new THREE.Vector3(ISO_TH, ISO_TH, -ISO_ZU).normalize()
const ISO_RIGHT = new THREE.Vector3(1, -1, 0).normalize()
const ISO_UP = ISO_DOWN.clone().negate()
const ISO_FORWARD = new THREE.Vector3().crossVectors(ISO_UP, ISO_RIGHT).normalize()
/** Pixels a metre of height is drawn at — the kit's own `ZU`. */
const ISO_PX_PER_M = ISO_ZU / Math.abs(new THREE.Vector3(0, 0, 1).dot(ISO_UP))
/** How much the sheet widens the picture: the kit draws an x-step `2 : 1`, an ortho camera `1.58 : 1`. */
export const ISO_STRETCH = (ISO_TW / Math.SQRT1_2) / ISO_PX_PER_M

const ELEV_PX_PER_M = 50
/** The plan is drawn at the platform sheet's own 31 px/m so it drops straight in. */
const PLAN_PX_PER_M = 31

/** One consist to build, and how to look at it. */
interface TrainScene {
  stock: StockClass
  cars: number
  doorsOpen: boolean
  from: THREE.Vector3
  span: Span
  /** Set for a true elevation, which frames a fixed box instead of the built geometry. */
  elevation?: Elevation
  /** Cleared to nothing instead of a colour, so a sheet can lay the picture over its own drawing. */
  transparent?: boolean
  /**
   * Build the **track** the consist runs on instead of the consist. One module, as long
   * as the train (`trackPieceForLine`), because that is how the game lays it: a single
   * piece per line, not a row of cells.
   */
  track?: boolean
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
    note: 'L 型六节编组示例',
    width: 1504,
    height: 300,
    scene: { stock: 'L', cars: 6, doorsOpen: false, from: CONSIST, span: 'consist' as Span },
  },
  // The two true elevations, one per class: the frontal one is where width and height
  // read, the side one is where the door cadence and the body's length read. Both are
  // framed in the same box for every class, so the four can be laid side by side, and
  // both are cleared to nothing: an elevation is a drawing of a car, with no ground of
  // its own, so a sheet composites it into its own drawing rather than into a box.
  ...STOCK_CLASSES.map((cls) => ({
    id: `front-${cls}`,
    label: `${cls} 型正面`,
    note: '正对车头看：宽和高',
    width: Math.round(2 * ELEV_HALF_Y * ELEV_PX_PER_M),
    height: Math.round((ELEV_Z[1] - ELEV_Z[0]) * ELEV_PX_PER_M),
    scene: {
      stock: cls,
      cars: 2,
      doorsOpen: false,
      from: FRONT_ON,
      span: 'car' as Span,
      elevation: 'front' as Elevation,
      transparent: true,
    },
  })),
  ...STOCK_CLASSES.map((cls) => ({
    id: `side-${cls}`,
    label: `${cls} 型侧面`,
    note: '正对车身看：长度和门的节奏',
    width: Math.round(2 * ELEV_HALF_X * ELEV_PX_PER_M),
    height: Math.round((ELEV_Z[1] - ELEV_Z[0]) * ELEV_PX_PER_M),
    scene: {
      stock: cls,
      cars: 2,
      doorsOpen: false,
      from: SIDE_ON,
      span: 'car' as Span,
      elevation: 'side' as Elevation,
      transparent: true,
    },
  })),
  // The drawing kit's own view, for the sheets drawn as isometric scenes: `tools/iso.mjs`
  // projects with `px = (x - y) * TW`, `py = (x + y) * TH - z * ZU`, so a car for one of
  // those has to be rendered **on the kit's screen axes** rather than on the world's.
  ...(['A', 'B', 'L'] as StockClass[]).map((cls) => ({
    id: `iso-${cls}`,
    label: `${cls} 型等轴`,
    note: '画法用等轴投影，和场景一套轴',
    width: 1200,
    height: 1150,
    scene: {
      stock: cls,
      cars: 2,
      doorsOpen: false,
      from: new THREE.Vector3(1, 1, -1),
      span: 'car' as Span,
      elevation: 'iso' as Elevation,
      transparent: true,
    },
  })),
  /**
   * **One** car of the B type, isometric, for a sheet whose platform is short.
   *
   * The three above are two-car consists on purpose: a specimen a catalogue lays side by side
   * wants one cab end and one gangway, and the sheets that carry rolling stock are about the
   * stock. A station drawing is about the station, and its platform is whatever the plan says —
   * sheet 01's is 24 m, so a 40 m consist hangs 8 m off each end of it. A one-car consist is
   * reachable in the game (the 编组 slider runs 1–8), so this is the stock that fits, photographed
   * and measured exactly like the rest.
   */
  {
    id: 'iso-B1',
    label: 'B 型等轴（单节）',
    note: '单节编组：短站台站得下的那一节',
    width: 1200,
    height: 1150,
    scene: {
      stock: 'B',
      cars: 1,
      doorsOpen: false,
      from: new THREE.Vector3(1, 1, -1),
      span: 'car' as Span,
      elevation: 'iso' as Elevation,
      transparent: true,
    },
  },
  // The plan, cleared to nothing: the platform sheet lays it over its own drawing of
  // the platform, the track and the queue lanes, so it has to composite rather than
  // sit in a box of its own. Drawn at that sheet's scale, not this one's.
  {
    id: 'plan-B',
    label: 'B 型平面',
    note: '从上看：两节车，中间是贯通道',
    width: Math.round(2 * PLAN_HALF_X * PLAN_PX_PER_M),
    height: Math.round(2 * ELEV_HALF_Y * PLAN_PX_PER_M),
    scene: {
      stock: 'B',
      cars: 2,
      doorsOpen: false,
      from: PLAN_ON,
      span: 'consist' as Span,
      elevation: 'plan' as Elevation,
      transparent: true,
    },
  },
  // And the track it stands on — the game's own TrackModel, in the same box, so the two
  // plans overlay each other exactly.
  {
    id: 'plan-track-B',
    label: 'B 型轨道平面',
    note: '一条线路就是一块轨道：和列车一样长，两条钢轨加中间的枕木',
    width: Math.round(2 * PLAN_HALF_X * PLAN_PX_PER_M),
    height: Math.round(2 * ELEV_HALF_Y * PLAN_PX_PER_M),
    scene: {
      stock: 'B',
      cars: 2,
      doorsOpen: false,
      from: PLAN_ON,
      span: 'consist' as Span,
      elevation: 'plan' as Elevation,
      transparent: true,
      track: true,
    },
  },
]

export interface TrainFrame {
  id: string
  /** Capture-only pose variants reuse a specimen's fixed camera and frame. */
  baseId?: string
  doorProgress?: number
  headlights?: boolean
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
  /**
   * Which way the car was looked at, so a sheet knows which axis is up the picture — one of
   * `Elevation`, or null for a piece shot from no declared angle.
   */
  kind: Elevation | null
  /**
   * The box's span **up the picture**, in metres — the z extent for a front or a side,
   * the y extent for a plan. A sheet needs both spans: one to get the scale, this one to
   * keep the drawing from being squashed, since a car seen from the front is 3.4 m across
   * and 4.4 m tall.
   */
  verticalMetres: number | null
  /**
   * The elevation's own box, in metres — `x`/`y`/`z` are `[min, max]`. A sheet needs it
   * to know where a metre falls inside the picture: where the rail line sits (from `z`,
   * which is how a car gets stood on the track bed rather than floated at the platform's
   * own level) and where a door centre sits (from `x`, in the plan and the side).
   */
  box: { x: [number, number]; y: [number, number]; z: [number, number] } | null
}

export interface CapturedTrain {
  id: string
  width: number
  height: number
  png: string
  /**
   * Where the model's **origin** lands in the picture, as a fraction of it: `u` across from
   * the left, `v` down from the top.
   *
   * An isometric view has no horizontal datum to sit on — the ground is a diamond, not a
   * line — so this is the point a sheet anchors the picture by. Null for the axis-aligned
   * views, which have a rail or a centreline instead.
   */
  origin: [number, number] | null
  /**
   * The frustum the frame was drawn in, in metres across and up — the **real** extents of a
   * fitted frame, which for an isometric consist is not the box's own span: the box is
   * measured on the kit's screen rows and then padded, so a sheet that wants the picture's
   * scale reads it here rather than reconstructing the pad.
   */
  frameMetres: number
  frameVertical: number
  /**
   * The world box the frame was drawn around, in metres.
   *
   * An isometric view frames **its own geometry** rather than a fixed box, so its extents are
   * only known once the consist has been built — a sheet reading `trainPieces` alone would have
   * no box at all for it. That is why the render reports one back.
   */
  box: { x: [number, number]; y: [number, number]; z: [number, number] }
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

/**
 * The fixed box a true elevation is framed in, in metres, or null for a fitted view.
 *
 * Both the capture and the sheet's index go through here, so the box a sheet measures
 * against is the box that was actually rendered rather than a second copy of it.
 *
 * The two axis-aligned elevations share a box so their classes can be laid side by side, and a
 * plan is framed in the consist's own plan box. An **isometric** view is in neither camp: it is
 * fitted to the consist that was built (see the render loop), so there is no box to state here
 * — the capture hands back the one it measured instead.
 */
function elevationBox(scene: TrainScene): THREE.Box3 | null {
  if (!scene.elevation || scene.elevation === 'iso') return null
  const [x0, x1] = spanOf(scene)
  const centre = (x0 + x1) / 2
  if (scene.elevation === 'front') {
    return new THREE.Box3(
      new THREE.Vector3(x0, -ELEV_HALF_Y, ELEV_Z[0]),
      new THREE.Vector3(x1, ELEV_HALF_Y, ELEV_Z[1]),
    )
  }
  if (scene.elevation === 'side') {
    return new THREE.Box3(
      new THREE.Vector3(centre - ELEV_HALF_X, -ELEV_HALF_Y, ELEV_Z[0]),
      new THREE.Vector3(centre + ELEV_HALF_X, ELEV_HALF_Y, ELEV_Z[1]),
    )
  }
  const halfX = Math.max(PLAN_HALF_X, (STOCK[scene.stock].length * scene.cars) / 2 + 1)
  return new THREE.Box3(
    new THREE.Vector3(centre - halfX, -ELEV_HALF_Y, ELEV_Z[0]),
    new THREE.Vector3(centre + halfX, ELEV_HALF_Y, ELEV_Z[1]),
  )
}

/**
 * The box's span across the picture, which is the axis the camera stands its right vector on.
 *
 * The isometric view had a row here too — `(Δx + Δy) / √2`, the kit's own across row. It is gone
 * with `elevationBox`'s isometric case: that row is what a sheet already applies to the frame
 * the render reports, and stating the same extent twice is how the two came to disagree.
 */
function elevationMetres(scene: TrainScene, box: THREE.Box3): number {
  return scene.elevation === 'front' ? box.max.y - box.min.y : box.max.x - box.min.x
}

/** The box's span up the picture, which is the camera's other axis. */
function elevationVertical(scene: TrainScene, box: THREE.Box3): number {
  return scene.elevation === 'plan' ? box.max.y - box.min.y : box.max.z - box.min.z
}

/** The sheet's frames and the text each picture wears. */
export function trainPieces(background = '#0d141d'): { frames: TrainFrame[]; pieces: TrainPiece[] } {
  const frames: TrainFrame[] = []
  const pieces: TrainPiece[] = []
  for (const show of SHOW) {
    frames.push({
      id: show.id,
      width: show.width,
      height: show.height,
      background: show.scene.transparent ? undefined : background,
    })
    const box = elevationBox(show.scene)
    pieces.push({
      id: show.id,
      label: show.label,
      note: show.note,
      metres: box ? elevationMetres(show.scene, box) : null,
      kind: show.scene.elevation ?? null,
      verticalMetres: box ? elevationVertical(show.scene, box) : null,
      box: box
        ? {
            x: [box.min.x, box.max.x],
            y: [box.min.y, box.max.y],
            z: [box.min.z, box.max.z],
          }
        : null,
    })
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
  renderer.setPixelRatio(2)
  // The station's own rig and renderer settings, not a rig of this pass's own: the sheet
  // exists to show what the player sees.
  applyStationRenderer(renderer)

  const scene = new THREE.Scene()
  addStationLights(scene)

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 2000)
  camera.up.set(0, 0, 1)

  const mats: ModelMaterials = createModelMaterials()
  const byId = new Map(SHOW.map((s) => [s.id, s]))
  let done = 0

  try {
    for (const frame of frames) {
      const show = byId.get(frame.baseId ?? frame.id)
      if (!show) continue
      const s = STOCK[show.scene.stock]
      // `TrackModel` reads only `ctx.mats` and `ctx.preview` off the context it is handed
      // — the surface finishes, the ad artwork and the station data are for pieces that
      // print something on themselves. Casting a two-field context is narrower than
      // standing up the app's whole `ModuleContext` to draw two rails and some sleepers.
      const trackCtx = { mats, preview: false } as unknown as ModuleContext
      const group = show.scene.track
        ? new TrackModel(trackCtx).build(
            makeTrack({
              id: show.id,
              lineId: '5',
              dir: 'up',
              power: 'third-rail',
              rot: 0,
              // Centred on the world origin, so the track's centreline is y = 0 and its
              // run is x ∈ [−w/2, w/2] — the same frame the consist is built in, which
              // is what lets the two plans be laid over each other.
              x: -trainLength(show.scene) / 2,
              y: -RAIL_BED_DEPTH / 2,
              z: 0,
              w: Math.ceil(trainLength(show.scene)),
              d: RAIL_BED_DEPTH,
              tunnel: true,
            }),
          )
        : buildTrain(mats, {
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
      if (!show.scene.track) setDoors(group, frame.doorProgress ?? (show.scene.doorsOpen ? 1 : 0))
      mats.headlight.color.setHex(frame.headlights === false ? 0x27303a : 0xfff6e2)
      scene.add(group)

      renderer.setSize(frame.width, frame.height, false)
      if (show.scene.transparent) renderer.setClearAlpha(0)
      else {
        renderer.setClearAlpha(1)
        renderer.setClearColor(frame.background ?? '#0d141d', 1)
      }

      // Frame the part of the consist the picture is of. A true elevation frames a
      // **fixed box** instead, identical for every class, so the four share one scale.
      // Otherwise the box is cut from the span in metres and intersected with the built
      // geometry, so a single car fills its frame instead of shrinking into a 30 : 1
      // silhouette.
      const [x0, x1] = spanOf(show.scene)
      /**
       * `up` is the axis the camera treats as vertical, and it cannot be the axis it is
       * looking along — so the plan, seen straight down, stands the train's width up.
       */
      const iso = show.scene.elevation === 'iso'
      let box =
        elevationBox(show.scene) ??
        new THREE.Box3(
          new THREE.Vector3(x0, -s.width / 2 - 0.2, -0.2),
          new THREE.Vector3(x1, s.width / 2 + 0.2, s.height + 0.6),
        )
      /**
       * A fitted view frames the geometry, and the **isometric** one has to as well.
       *
       * `buildTrain` lays the cars out from the world origin, so a two-car consist sits at
       * `x = 0…40`, while the box the isometric view used to be handed — the plan's ±21 m
       * window, shared with `plan-B` — is centred half a consist behind that. The camera then
       * aimed at a box the train was not inside: the figure came back shoved across its own
       * frame, and the leading car's end was sliced off flat by the picture's edge. That is
       * what reached sheet 13 as "the train's end is cropped", and no pad over the wrong box
       * can fix it — the box is what has to be the train.
       */
      if (iso) {
        const built = objectBox(group)
        if (!built.isEmpty()) box = built
      } else if (!show.scene.elevation) {
        const built = objectBox(group)
        if (!built.isEmpty()) box.intersect(built)
      }
      camera.up.copy(iso ? ISO_UP : show.scene.elevation === 'plan' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1))

      const aim = box.getCenter(new THREE.Vector3())
      // The fitted frame is symmetric about the camera's axis, so the camera has to look at
      // the **centre of the consist**. It was looking at the view's `aim`, which sits about a
      // car's length off it, and that is what sliced the far end of the train flat along the
      // picture's own edge while leaving the cab end whole. (`aim` is recomputed later, so
      // setting it here did nothing — the camera is what has to move.)
      const framed = iso ? box.getCenter(new THREE.Vector3()) : aim
      camera.position.copy(framed).addScaledVector(iso ? ISO_FORWARD : show.scene.from, 200)
      // NOTE for the sheet: the drawing kit's projection is **left-handed** against a true
      // view from this corner. `train-iso.mjs` draws a +x car with its nose to the right and
      // its +y side near, and this camera — which sits on that same corner, so the faces are
      // right — puts the nose on the left. `camera.scale.x = -1` here changes the file's
      // bytes and not the picture (three.js builds the ortho frustum from `left/right` and
      // leaves the camera's scale out of it), so the mirror belongs on the **image element**
      // in the sheet, where the handedness lives anyway.
      camera.lookAt(framed)
      camera.updateMatrixWorld(true)
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

      const aspect = frame.height > 0 ? frame.width / frame.height : 1
      let mx = 0
      let my = 0
      // The kit's own screen axes are not the camera's, so the extents that frame an
      // isometric car are measured along `ISO_RIGHT` / `ISO_UP` rather than in world x/z.
      const along = iso
        ? (v: THREE.Vector3) => [
            (v.x - v.y) * Math.SQRT1_2,
            (v.x + v.y) * (ISO_TH / Math.hypot(ISO_TH, ISO_TH, ISO_ZU)) - v.z * (ISO_ZU / Math.hypot(ISO_TH, ISO_TH, ISO_ZU)),
          ]
        : null
      for (let i = 0; i < 8; i++) {
        const corner = new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        )
        if (along) {
          const [rx, ry] = along(corner.clone().sub(box.getCenter(new THREE.Vector3())))
          mx = Math.max(mx, Math.abs(rx))
          my = Math.max(my, Math.abs(ry))
          continue
        }
        const v = corner.applyMatrix4(camera.matrixWorldInverse)
        mx = Math.max(mx, Math.abs(v.x))
        my = Math.max(my, Math.abs(v.y))
      }
      // A consist is long and runs across the kit's screen axes diagonally, so it needs more
      // room than an axis-aligned view: at 1.05 the frame's edge cut the train's ends.
      // Frame the **centre of the consist**, not wherever the view's aim happened to be. A
      // fitted frame is symmetric about the camera's axis, so an aim that sits off-centre
      // crops one end of the train — which is what cut the viaduct consist's nose off flat
      // along the picture's own edge.
      if (iso) aim.copy(box.getCenter(new THREE.Vector3()))
      // **The isometric margin is measured on the drawing, not guessed.** `mx`/`my` above
      // are the box's *corners* projected on the kit's axes, and a car is not its corners:
      // its roof, its flank and its bogies all hang outside the line between two of them,
      // so a pad that only just holds the eight corners still ends with the cab's own end
      // face flat against the picture's edge and sliced off — which is what reached sheet
      // 13 as "the train's end is cropped". The pad is generous because the room it buys
      // costs nothing: the picture is transparent and the sheet anchors it by its origin.
      const PAD = iso ? 1.4 : 1.05
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

      // Where the model's origin falls in the picture, for the views that need a point
      // rather than a line to be anchored by.
      let origin: [number, number] | null = null
      if (along) {
        const [ox, oy] = along(new THREE.Vector3().sub(box.getCenter(new THREE.Vector3())))
        // `along`'s second component is the kit's **down** row, `(TH, TH, -ZU)`: a point
        // lower on the screen measures larger. So the fraction *down* the picture is this
        // plus a half. Subtracting it put every consist about a metre high.
        origin = [0.5 + ox / (2 * halfW), 0.5 + oy / (2 * halfH)]
      }

      renderer.render(scene, camera)
      out.push({
        id: frame.id,
        width: frame.width,
        height: frame.height,
        png: renderer.domElement.toDataURL('image/png'),
        origin,
        frameMetres: 2 * halfW,
        frameVertical: 2 * halfH,
        box: {
          x: [box.min.x, box.max.x],
          y: [box.min.y, box.max.y],
          z: [box.min.z, box.max.z],
        },
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
