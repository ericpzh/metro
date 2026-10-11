import type { PickResult, SceneRenderer } from '../../render/scene.ts'
import type { Module } from '../../sim/types.ts'

/** Booth geometry is separate from the floor ray; aim at the visible booth face (§9.5). */
export function boothSignHit(
  scene: SceneRenderer, modules: readonly Module[], clientX: number, clientY: number, fallback: PickResult | null,
): PickResult | null {
  const surface = scene.pickModuleHit?.(clientX, clientY)
  const booth = surface && modules.find((m) => m.id === surface.moduleId && m.type === 'booth')
  if (!surface || !booth) return fallback
  const cell: [number, number, number] = [Math.floor(surface.point[0]), Math.floor(surface.point[1]), booth.z]
  return { cell, place: cell, solid: false, normal: [0, 0, 1], point: surface.point }
}
