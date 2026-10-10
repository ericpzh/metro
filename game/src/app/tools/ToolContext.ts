// Lane C step 0 — the contract every tool controller shares (plan.md, Lane C).
//
// `Viewport.tsx` owns the SceneRenderer lifecycle and the mutable pointer refs;
// the controllers own the per-tool pointer logic. This interface is the seam
// between the two, so parallel controller work cannot collide semantically:
// a controller reads hover/drag state and ghosts only through here, and commits
// only through the zustand store. Zero behaviour change — the shapes below are
// the ref types `Viewport.tsx` has always held, lifted verbatim.

import type { PickResult, SceneRenderer } from '../../render/scene.ts'
import type { WallDir } from '../../build/model.ts'
import type { CellShape, Face } from '../../sim/types.ts'
import type { ZoneBrush } from '../store.ts'

/** The tile under the pointer, kept so R and Tab can rebuild a ghost in place. */
export interface HoverTile {
  cell: [number, number, number]
  place: [number, number, number]
  solid: boolean
  point?: [number, number]
}

/**
 * An in-progress press-and-hold shared by the 方块 / 墙 / 删除 / 围栏 tools.
 * One ref serves all four because only one tool is ever active — the tool-change
 * effect in `Viewport.tsx` clears it when leaving.
 */
export interface AreaDrag {
  active: boolean
  button: number
  mode: 'add' | 'remove'
  anchor: [number, number, number]
  z: number
  shift: boolean
  /** True for the 墙 tool's drag, whose cells are full-height wall columns. */
  wall?: boolean
  /**
   * A wall drag that never becomes a run: the 方块 tool's **半墙** mode lays one
   * block per click, so the release takes the press's own cell whatever the
   * pointer did in between.
   */
  single?: boolean
  /**
   * The cut shape a **方块** click lays — a **半墙**'s thickness side or a **三角**'s
   * hugged side (`cutShapeFor` over `wallDirs`), resolved at the press and kept
   * current as **R** steps it. The release lays this shape, so the piece that lands is
   * the one the ghost drew rather than a second, possibly different, reading of the
   * same geometry.
   */
  shape?: CellShape | null
  /**
   * The faces the pressed column's own geometry opens onto (`wallSnap`'s
   * candidates), kept so a 半墙 or 三角 can re-derive its shape as **R** steps it.
   */
  wallDirs?: WallDir[]
  /** True for the 围栏 tool's drag, which lays one fence panel per cell. */
  fence?: boolean
  /** A tactile paving run, placed or deleted along a straight floor line. */
  tactile?: boolean
  /** Roof tiles or small stair blocks laid/removed on the pressed plane. */
  roof?: boolean
  /** This roof/stair-block drag was started from 删除. */
  deleteTile?: boolean
  /** The tile family and geometry captured when a roof/stair-block delete drag starts. */
  tileType?: string
  tileRot?: number
  tileWidth?: number
  /** Current tile rectangle, for live R/Tab preview updates while dragging. */
  tileCells?: Array<[number, number, number]>
  /**
   * The delete tool's module drag: the ids it has collected, the pressed piece
   * first. A single id is the plain "remove this whole piece" press; a longer
   * list is a same-type sweep (§9.5), bulldozed in one commit on release.
   */
  modules?: string[]
  /**
   * The sweep identity every collected module shares (`sweepFamily`). Unset
   * for a piece that may not be swept — a room, a rail, an exit, a 楼梯 — so
   * its drag stays the single piece it pressed.
   */
  family?: string
  /** Last pointer position, so a fast drag samples the path between events. */
  lx?: number
  ly?: number
  /** Screen position and time of the press, to tell a click from a drag. */
  sx: number
  sy: number
  downTime: number
}

/** The paint tool's own drag: press a face, drag a rectangle on its plane. */
export interface PaintDrag {
  active: boolean
  button: number
  face: Face
  anchor: [number, number, number]
  sx: number
  sy: number
  downTime: number
}

/** The zone tool's rectangle drag: a fare-zone patch or a facility room. */
export interface ZoneDragState {
  active: boolean
  /** The active brush when the press began: a fare zone or a room kind. */
  brush: ZoneBrush
  anchor: [number, number, number]
  z: number
  sx: number
  sy: number
  downTime: number
}

/**
 * The shop right-click drag: the press holds a shop, the rectangle previews
 * either the wall openings to cut (cyan) or the whole store to delete (red),
 * and the release applies it.
 */
export interface FacilityDragState {
  active: boolean
  id: string
  anchor: [number, number, number]
  z: number
  sx: number
  sy: number
  downTime: number
}

/**
 * One pointer event, decoupled from React so controllers stay testable and
 * free of DOM types. `hit` is the viewport's pick for this event, computed
 * once per event by `Viewport.tsx` — controllers must not re-pick for it.
 */
export interface PointerInfo {
  clientX: number
  clientY: number
  button: number
  buttons: number
  shiftKey: boolean
  hit: PickResult | null
  preventDefault: () => void
}

/**
 * Everything a controller may touch: the scene (nullable before boot), the
 * shared mutable refs, and the patch-size badge. Commits go through
 * `useStore.getState()` from the `app/store.ts` barrel, never through here.
 */
export interface ToolContext {
  scene: () => SceneRenderer | null
  pick: (clientX: number, clientY: number) => PickResult | null
  pickModule: (clientX: number, clientY: number) => string | null
  facing: () => [number, number] | undefined
  /** Solid cell keys, refreshed with the station. */
  solids: () => Set<string>
  /**
   * The keys of the cells a **zone may be painted on** — the station's floor by
   * `build/model.ts`'s own rule (`zoneFloorKeys`) — refreshed with the station.
   * The 分区 brush paints nothing else (§4.5): a wall coping and a ceiling are
   * solid, and solid is not floor.
   */
  floors: () => Set<string>
  /** Half-block-thick cells (半墙 and ramp-kept panels), refreshed with the station. */
  thins: () => Map<string, CellShape>
  hover: { current: HoverTile | null }
  drag: { current: AreaDrag | null }
  paint: { current: PaintDrag | null }
  zoneDrag: { current: ZoneDragState | null }
  facilityDrag: { current: FacilityDragState | null }
  /** Pin the 方块 patch-size badge to the pointer, in canvas-relative pixels. */
  showMeasure: (clientX: number, clientY: number, text: string) => void
  clearMeasure: () => void
}
