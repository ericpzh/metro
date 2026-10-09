// Above-ground equipment; dimensions shared by placement and the models (§4.1, §5).
import { inCellOffset } from './inCellPositions.ts'
import { trackCellAt } from './track.ts'
import type { BridgeRailing, Module } from './types.ts'
export const PILLAR_STEP = 4
export const PILLAR_SHORT_STEP = 2
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
export const TRUSS_ROOF_HEIGHT = 4
export const TRUSS_ROOF_EAVE = 7
export const TRUSS_ROOF_SKIN = 0.12
export const TRUSS_ROOF_CHORD = 0.4
export function trussRoofRidge(_width: number): number { return TRUSS_ROOF_BASE + TRUSS_ROOF_HEIGHT - TRUSS_ROOF_SKIN }
export function trussRoofTop(width: number): number { return trussRoofRidge(width) + TRUSS_ROOF_SKIN }
export const DEFAULT_ROOF_FINISH = 'wall.plaster'
export type PillarModule = Extract<Module, { type: 'pillar' }>
export function pillarWidth(m: PillarModule): number { return m.cfg.size === 'thick' ? 1 : 0.3 }
/** Slim supports follow the shared centre-then-reading-order cycle. */
export function pillarOffset(m: PillarModule): { x: number; y: number } {
  return m.cfg.size === 'slim' ? inCellOffset(m.rot ?? 0, pillarWidth(m)) : { x: 0, y: 0 }
}
export const BRIDGE_DECK_DEPTH = 1
/** The whole deck must clear the street slab, whose top is z=1 (§4.1). */
export const BRIDGE_MIN_Z = BRIDGE_DECK_DEPTH + 1
/** Sound barrier top above the track anchor; the bed surface is at +0.5 m. */
export const BRIDGE_BARRIER_TOP = 3.5
export function bridgeBarrierTop(railing: BridgeRailing | undefined): number {
  return railing === 'sound-barrier-half' ? 2 : railing === 'sound-barrier' ? BRIDGE_BARRIER_TOP : 1.29
}
export function nextBridgeRailing(railing: BridgeRailing): BridgeRailing {
  return railing === 'railing' ? 'sound-barrier-half' : railing === 'sound-barrier-half' ? 'sound-barrier' : 'railing'
}
export function bridgeRailingLabel(railing: BridgeRailing): string {
  return railing === 'sound-barrier-half' ? '半高声屏障' : railing === 'sound-barrier' ? '全高声屏障' : '栏杆'
}
export function pillarSupportsBridge(pillar: Module, track: Module): boolean {
  return pillar.type === 'pillar' && track.type === 'track' && track.cfg.bridge === true
    && pillar.z + pillar.cfg.height === track.z && trackCellAt(track, pillar.x, pillar.y, track.z)
}
export function extendedPillar(m: PillarModule, step = PILLAR_STEP): PillarModule {
  return { ...m, cfg: { ...m.cfg, height: m.cfg.height + step } }
}
