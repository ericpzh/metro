// The pointer-tool base class (plan.md Lane C, R4 + R5): one subclass per tool,
// one file per subclass. The base owns the event shape (`onDown`/`onMove`/`onUp`
// plus the `refreshHover` ghost hook the R/Tab effects call) and the two
// teardown helpers every right-click shares. Ghost/preview builders stay in the
// subclasses — a 围栏 run preview must never be edited alongside a fare-zone
// patch. Zero behaviour change: bodies moved verbatim from app/Viewport.tsx.

import { removeFacility, removeModule } from '../../build/model.ts'
import { railModuleAt } from '../../build/rail.ts'
import { moduleAt } from '../../sim/placement.ts'
import type { Module } from '../../sim/types.ts'
import { moduleLabel, useStore, type Tool } from '../store.ts'
import type { PointerInfo, ToolContext } from './ToolContext.ts'

export abstract class ToolController {
  protected ctx: ToolContext
  constructor(ctx: ToolContext) {
    this.ctx = ctx
  }

  abstract readonly tool: Tool | 'move'
  abstract onDown(info: PointerInfo): void
  abstract onMove(info: PointerInfo): void
  abstract onUp(info: PointerInfo): void

  /**
   * Rebuild the hover ghost from the last hovered tile. Called by the R/Tab
   * effects in `Viewport.tsx` so a ghost redraws under a still pointer. Tools
   * without a settings-driven ghost keep this no-op.
   */
  refreshHover(): void {}

  protected pickModuleAt(info: PointerInfo): string | null {
    return this.ctx.pickModule(info.clientX, info.clientY)
  }

  protected facing(): [number, number] | undefined {
    return this.ctx.facing()
  }

  /** Remove one placed module, routing rails and rooms through their own teardown. */
  protected removePlacedModule(mod: Module): void {
    const st = useStore.getState()
    if (mod.type === 'track') {
      st.removeRail(mod.id)
      st.select(null)
      this.ctx.scene()?.setModulePreview(null)
      this.ctx.scene()?.setCollisionHighlight(null)
      return
    }
    // Facility rooms take their auto walls with them; the floor stays.
    st.commit(
      mod.type === 'shop' || mod.type === 'booth' || mod.type === 'retail'
        ? removeFacility(st.station, mod.id)
        : removeModule(st.station, mod.id),
    )
    st.select(null)
    this.ctx.scene()?.setModulePreview(null)
    this.ctx.scene()?.setCollisionHighlight(null)
    st.setNotice(`已拆掉${moduleLabel(mod.type, mod.type === 'shop' || mod.type === 'booth' ? mod.cfg.kind : undefined)}`)
  }

  /**
   * Right-click: remove the equipment standing on a cell, leaving the block.
   *
   * The camera's own look direction is handed to `moduleAt`, because the one cell
   * that can hold two pieces — a back-to-back 电视 pair — is a single object seen
   * from two sides: without the direction the pick would fall back to the document's
   * order, and a right-click would bulldoze whichever of the two happened to be
   * listed first rather than the face under the pointer.
   */
  protected bulldoze(cell: [number, number, number], place?: [number, number, number], facing?: readonly [number, number]): void {
    const st = useStore.getState()
    // A rail's bed is dug, so the module is found from the hit or the cell above.
    const rail =
      railModuleAt(st.station, cell[0], cell[1], cell[2]) ??
      (place ? railModuleAt(st.station, place[0], place[1], place[2]) : undefined)
    if (rail) {
      this.removePlacedModule(rail)
      return
    }
    const mod = moduleAt(st.station.modules, cell[0], cell[1], cell[2], facing)
    if (mod) this.removePlacedModule(mod)
  }
}
