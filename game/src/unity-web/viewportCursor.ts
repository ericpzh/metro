import type { Tool } from '../app/store.ts'

/** Tools whose canvas cursor is replaced by a themed floating SVG icon (parity with `app/Viewport.tsx`). */
export type CustomToolCursor = 'move' | 'delete' | 'pick'

/** Pointer-to-icon offset in CSS pixels, matching `app/Viewport.tsx` (`left + 5, top + 5`). */
export const TOOL_POINTER_OFFSET = { x: 5, y: 5 } as const

export interface ViewportCursorContext {
  tool: Tool
  sectionOn?: boolean
  sectionHot?: boolean
  explodedView?: boolean
  followAgentId?: number | null
  benchmarkActive?: boolean
}

/**
 * Resolve which custom SVG tool pointer (if any) owns the Unity viewport canvas.
 * Mirrors `app/Viewport.tsx` while suppressing custom tool pointers when the canvas
 * is owned by Exploded View, first-person passenger view, benchmark mode, or an
 * interactive section-cut grab handle.
 */
export function customToolCursorFor(context: ViewportCursorContext): CustomToolCursor | null {
  if (context.explodedView || context.benchmarkActive || (context.followAgentId ?? null) !== null) {
    return null
  }
  if (context.sectionOn && context.sectionHot) {
    return null
  }
  if (context.tool === 'move' || context.tool === 'delete' || context.tool === 'pick') {
    return context.tool
  }
  return null
}

/**
 * Read whether the pointer is currently hovering or dragging the section-cut surface.
 * Prefers the immediate `state.edit.sectionHot` flag from `pointer.*` acks and falls
 * back to `state.view.sectionHandle.{hovered,active}`.
 */
export function readSectionHot(state: Record<string, unknown> | null | undefined): boolean {
  if (!state || typeof state !== 'object') return false
  const edit = state.edit as Record<string, unknown> | null | undefined
  if (edit && typeof edit.sectionHot === 'boolean') return edit.sectionHot
  const view = state.view as Record<string, unknown> | null | undefined
  const handle = view?.sectionHandle as Record<string, unknown> | null | undefined
  if (!handle || typeof handle !== 'object') return false
  return handle.hovered === true || handle.active === true
}

/** Position the floating tool icon relative to the viewport container, scaled by UI scale. */
export function toolPointerPosition(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number } | null,
  uiScale = 1,
): { left: number; top: number } {
  const scale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1
  return {
    left: clientX - (rect?.left ?? 0) + Math.round(TOOL_POINTER_OFFSET.x * scale),
    top: clientY - (rect?.top ?? 0) + Math.round(TOOL_POINTER_OFFSET.y * scale),
  }
}

/**
 * Synchronize viewport cursor CSS classes on `#unity-canvas` without clobbering
 * unrelated classes (such as `.explodedArrangeCanvas` owned by `UnityExplodedView`).
 */
export function syncViewportCanvasClasses(
  canvas: Pick<HTMLCanvasElement, 'classList'>,
  context: ViewportCursorContext,
): CustomToolCursor | null {
  canvas.classList.add('viewport')
  const blocked = Boolean(context.explodedView || context.benchmarkActive || (context.followAgentId ?? null) !== null)
  const grab = !blocked && Boolean(context.sectionOn && context.sectionHot)
  const customCursor = customToolCursorFor(context)
  const selectCursor = !blocked && !grab && customCursor === null && context.tool === 'select'
  canvas.classList.toggle('selectCursor', selectCursor)
  canvas.classList.toggle('grab', grab)
  canvas.classList.toggle('toolPointer', customCursor !== null)
  return customCursor
}
