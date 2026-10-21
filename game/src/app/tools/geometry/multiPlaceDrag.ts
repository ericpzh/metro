// One budget, notice and refusal display for every placement drag that lays
// more than one cell or module.
//
// The controllers own their own footprints and verdicts, but they must not
// disagree about the point where a drag is too large, what the player is told,
// or what happens to the whole footprint. This module is that shared seam:
// count the raw footprint before allocating it, raise the notice while the
// pointer is still down, draw every refused cell as a red box, and commit
// nothing on release.
//
// A guard belongs to the ToolContext, not to a controller instance. The
// equipment tool dispatches road/tactile/tile drags to short-lived controllers
// (one per pointer event), so a timer or notice kept on `this` would be lost
// between the press, the move and the release. `multiPlaceFor` keeps the one
// active drag's guard with the context all of those controllers share.

import type { SceneRenderer } from '../../../render/scene.ts'
import { MAX_DRAG_CELLS } from '../../../sim/constants.ts'
import { msg } from '../../../sim/i18n.ts'
import { useStore } from '../../store.ts'
import { StablePreviewDelay } from './stablePreviewDelay.ts'
import { FramePreview } from './framePreview.ts'

/** A cell coordinate as the scene and drag tools spell it. */
export type DragCell = [number, number, number]

const guards = new WeakMap<object, MultiPlaceDrag>()

/** The guard shared by every controller using this context. */
export function multiPlaceFor(context: object): MultiPlaceDrag {
  let guard = guards.get(context)
  if (!guard) {
    guard = new MultiPlaceDrag()
    guards.set(context, guard)
  }
  return guard
}

/**
 * The shared multi-cell placement drag guard.
 *
 * `check`/`setNotice` own the bottom notice, `refuse` clears every accepted
 * preview and paints the whole footprint red, and `schedule` is the same
 * 50 ms latest-target cadence the 方块 preview uses. `scheduleFrame` coalesces cheap
 * replaceable previews without waiting for the pointer to stop. Both share
 * cancellation, the budget and the release verdict.
 */
export class MultiPlaceDrag {
  readonly limit: number
  private readonly delay: StablePreviewDelay
  private readonly frame = new FramePreview()
  private previewSnapshot: Pick<ReturnType<typeof useStore.getState>['station'], 'cells' | 'modules'> | null = null

  constructor(limit = MAX_DRAG_CELLS, delay = new StablePreviewDelay()) {
    this.limit = limit
    this.delay = delay
  }

  /** Invalidate a pending preview or refusal. */
  cancelPreview(): void {
    this.previewSnapshot = null
    this.delay.clear()
    this.frame.clear()
  }

  /** Flush the latest preview before a synchronous release path when needed. */
  flushPreview(): void {
    this.delay.flush()
    this.frame.flush()
  }

  /** Run the latest target within 50 ms without restarting a pending wait. */
  schedule(key: string, run: () => void): boolean {
    this.prepareSnapshot()
    this.frame.clear()
    return this.delay.scheduleLatest(key, run)
  }

  /** Cheap previews keep their prior draw until the latest target is ready next frame. */
  scheduleFrame(key: string, run: () => void): boolean {
    this.prepareSnapshot()
    this.delay.clear()
    return this.frame.scheduleLatest(key, run)
  }

  /** Edits/undo keep stationEpoch stable, so geometry identity owns invalidation. */
  private prepareSnapshot(): void {
    const { cells, modules } = useStore.getState().station
    if (this.previewSnapshot?.cells === cells && this.previewSnapshot.modules === modules) return
    this.cancelPreview()
    this.previewSnapshot = { cells, modules }
  }

  flushFramePreview(): void { this.frame.flush() }

  /** Keep the previous draw visible until the latest target replaces it. */
  deferPreview(_scene: SceneRenderer, key: string, run: () => void): boolean {
    return this.schedule(key, run)
  }

  /** An oversized target must never leave an accepted smaller footprint visible. */
  deferRefusal(scene: SceneRenderer, key: string, run: () => void): boolean {
    const changed = this.schedule(key, run)
    if (changed) this.clearPreview(scene)
    return changed
  }

  /** Clear every preview layer used by equipment, decor and block placement. */
  clearPreview(scene: SceneRenderer): void {
    scene.setGhost?.([], 'add')
    scene.setModulePreview?.(null)
    scene.setFencePreview?.(null)
    scene.setCollisionHighlight?.(null)
  }

  /**
   * Raise the shared area-too-large notice when `count` exceeds the budget, or
   * clear this guard's own notice when it does not. Returns the verdict.
   *
   * The clear is deliberately conditional: a drag shrinking back under the
   * budget must not steal an unrelated notice that happens to be on screen.
   */
  check(count: number): boolean {
    const over = count > this.limit
    this.setNotice(over)
    return over
  }

  /** Raise or clear this guard's own notice. */
  setNotice(over: boolean): void {
    const st = useStore.getState()
    const message = this.message()
    if (over) st.setNotice(message)
    else if (st.notice === message) st.setNotice(null)
  }

  /**
   * Refuse a footprint whole: clear every accepted preview kind the placement
   * tools use, then draw all of `cells` through the red refused-box pool.
   * Callers still decide whether to commit; an over-budget release must not.
   */
  refuse(scene: SceneRenderer | null, cells: ReadonlyArray<DragCell>, cursor: DragCell | null = null): void {
    this.setNotice(true)
    if (!scene) return
    this.clearPreview(scene)
    scene.setGhost([], 'add', undefined, undefined, cells)
    scene.setCursor(cursor, false)
  }

  private message(): string {
    return msg('drag_area_too_large', this.limit)
  }
}
