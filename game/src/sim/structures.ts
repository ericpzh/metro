// Above-ground equipment; dimensions shared by placement and the models (§4.1, §5).
import { trackCellAt } from './track.ts'
import type { Module } from './types.ts'
export const PILLAR_STEP = 4
export const ROOF_THICKNESS = 0.25
export const TRUSS_ROOF_BAY = 4
export const ROOF_WIDTHS = [4, 8, 12] as const
export function nextRoofWidth(width: number): number {
  const index = ROOF_WIDTHS.indexOf(width as (typeof ROOF_WIDTHS)[number])
  return ROOF_WIDTHS[(index + 1) % ROOF_WIDTHS.length]
}
export function roofWidthLabel(width: number): string {
  return width === 8 ? '中' : width === 12 ? '宽' : '窄'
}
export function supportedRoofWidth(width?: number): number {
  return width === 8 || width === 12 ? width : 4
}
/** Heights above the roof's supporting storey, whose slab top is local z=0. */
export const TRUSS_ROOF_BASE = 4
export const TRUSS_ROOF_EAVE = 6
export function trussRoofRidge(width: number): number { return TRUSS_ROOF_EAVE + width * 0.1 }
export function trussRoofTop(width: number): number { return trussRoofRidge(width) + 0.12 }
export const DEFAULT_ROOF_FINISH = 'wall.plaster'
export type PillarModule = Extract<Module, { type: 'pillar' }>
export function pillarWidth(m: PillarModule): number { return m.cfg.size === 'thick' ? 1 : 0.3 }
export const BRIDGE_DECK_DEPTH = 0.6
export function pillarSupportsBridge(pillar: Module, track: Module): boolean {
  return pillar.type === 'pillar' && track.type === 'track' && track.cfg.bridge === true
    && pillar.z + pillar.cfg.height === track.z && trackCellAt(track, pillar.x, pillar.y, track.z)
}
export function extendedPillar(m: PillarModule): PillarModule {
  return { ...m, cfg: { ...m.cfg, height: m.cfg.height + PILLAR_STEP } }
}
