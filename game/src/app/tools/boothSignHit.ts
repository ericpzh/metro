import type { PickResult, SceneRenderer } from '../../render/scene.ts'
import type { Module } from '../../sim/types.ts'

/** The booth the pointer names and the world point it was seen at. */
export interface BoothSignAim {
  booth: Extract<Module, { type: 'booth' }>
  point: [number, number, number]
}

/**
 * One booth pick for the whole pointer event: the drawn module under the ray, and
 * the booth it belongs to — the booth itself, or a **sign already bolted to one**
 * (a player aiming at the board on the header means that booth, not the floor the
 * ray finds behind it).
 */
export function boothSignAim(
  scene: SceneRenderer, modules: readonly Module[], clientX: number, clientY: number,
): BoothSignAim | undefined {
  const surface = scene.pickModuleHit?.(clientX, clientY)
  if (!surface) return undefined
  const picked = modules.find((m) => m.id === surface.moduleId)
  const booth = picked?.type === 'booth'
    ? picked
    : picked?.type === 'sign' && picked.cfg.boothId
      ? modules.find((m): m is Extract<Module, { type: 'booth' }> => m.type === 'booth' && m.id === picked.cfg.boothId)
      : undefined
  return booth ? { booth, point: surface.point } : undefined
}

/** The hover tile a picked booth hands the wall-sign tool: its own cell, above a floor. */
export function boothSignHitOf(aim: BoothSignAim): PickResult {
  const cell: [number, number, number] = [Math.floor(aim.point[0]), Math.floor(aim.point[1]), aim.booth.z]
  return { cell, place: cell, solid: false, normal: [0, 0, 1], point: aim.point }
}

/** Booth geometry is separate from the floor ray; aim at the visible booth face (§9.5). */
export function boothSignHit(
  scene: SceneRenderer, modules: readonly Module[], clientX: number, clientY: number, fallback: PickResult | null,
): PickResult | null {
  const aim = boothSignAim(scene, modules, clientX, clientY)
  return aim ? boothSignHitOf(aim) : fallback
}
