import type { SceneRenderer } from '../../render/scene.ts'

/** One reset for tool changes, cancellation and over-budget refusals. Sources,
 * selection and the station document remain owned by their normal systems. */
export function clearToolPreview(scene: SceneRenderer | null, cursor = false): void {
  if (!scene) return
  scene.setGhost?.([], 'add')
  scene.clearFaceGhost?.()
  scene.setModulePreview?.(null)
  scene.setFencePreview?.(null)
  scene.setCollisionHighlight?.(null)
  scene.setRoadNodePreview?.([])
  if (cursor) scene.setCursor?.(null)
}
