import { msg } from './i18n.ts'
import { DEFAULT_MATERIAL } from './finishes.ts'
// Above-ground equipment; dimensions shared by placement and the models (§4.1, §5).
import { inCellOffset } from './inCellPositions.ts'
import { rotateLocal, trackCellAt, trackCells } from './track.ts'
import type { BridgeRailing, Module } from './types.ts'
export const PILLAR_STEP = 5
/**
 * The section lengths a pillar is built and extended in, cycled with Tab:
 * 超短 2 m → 短 3 m → 中 4 m → 长 5 m → 超长 6 m. A click on an existing pillar
 * stacks the armed section on top of it, so a mixed stack stays one shaft.
 */
export const PILLAR_LENGTHS = [2, 3, 4, 5, 6] as const
export type PillarLength = (typeof PILLAR_LENGTHS)[number]
/** A fresh five-metre station's pillar section is 长 5 m, matching the storey. */
export const PILLAR_LENGTH_DEFAULT: PillarLength = PILLAR_STEP
export function nextPillarLength(length: number): PillarLength {
  const index = PILLAR_LENGTHS.indexOf(length as PillarLength)
  return PILLAR_LENGTHS[(index + 1) % PILLAR_LENGTHS.length]
}
/** The name the Tab tile wears for a section: 超短 / 短 / 中 / 长 / 超长. */
export function pillarLengthLabel(length: number): string {
  const labels = ['ultra_short', 'short', 'medium', 'long', 'ultra_long'] as const
  const index = PILLAR_LENGTHS.indexOf(length as PillarLength)
  return msg(labels[index < 0 ? 3 : index])
}
/** The section a placed pillar arms when picked; a legacy height falls back to 长. */
export function pillarSectionOf(height: number | undefined): PillarLength {
  return PILLAR_LENGTHS.includes(height as PillarLength) ? (height as PillarLength) : PILLAR_LENGTH_DEFAULT
}
export const ROOF_THICKNESS = 0.25
export const TRUSS_ROOF_BAY = 4
export const ROOF_WIDTHS = [4, 8, 12] as const
export function nextRoofWidth(width: number): number {
  const index = ROOF_WIDTHS.indexOf(width as (typeof ROOF_WIDTHS)[number])
  return ROOF_WIDTHS[(index + 1) % ROOF_WIDTHS.length]
}
export function roofWidthLabel(width: number): string {
  return width === 8 ? msg('medium') : width === 12 ? msg('wide') : msg('narrow')
}
export function supportedRoofWidth(width?: number): number {
  return width === 8 || width === 12 ? width : 4
}
/** Heights above the roof's supporting storey, whose slab top is local z=0. */
export const TRUSS_ROOF_BASE = 5
export const TRUSS_ROOF_HEIGHT = 5
export const TRUSS_ROOF_EAVE = 9
export const TRUSS_ROOF_SKIN = 0.12
export const TRUSS_ROOF_CHORD = 0.4
export function trussRoofRidge(_width: number): number { return TRUSS_ROOF_BASE + TRUSS_ROOF_HEIGHT - TRUSS_ROOF_SKIN }
export function trussRoofTop(width: number): number { return trussRoofRidge(width) + TRUSS_ROOF_SKIN }
/** Canopy shares the truss shell, lowered one storey onto its own round posts (§4.1). */
export const CANOPY_ROOF_DROP = 5
export const CANOPY_POST_RADIUS = 0.09
export function canopyPostRows(width: number): readonly [number, number] {
  const inset = width / 4 - 1
  return [inset, width - 1 - inset]
}
export function canopyPosts(m: Extract<Module, { type: 'roof' }>): Array<{ x: number; y: number; height: number }> {
  const posts: Array<{ x: number; y: number; height: number }> = []
  const ridge = trussRoofRidge(m.d)
  for (const y of canopyPostRows(m.d)) for (let x = 0; x < m.w; x++) {
    const height = ridge - (ridge - TRUSS_ROOF_EAVE) * Math.abs(y - (m.d - 1) / 2) / (m.d / 2) - CANOPY_ROOF_DROP - 0.1
    posts.push({ x, y, height })
  }
  return posts
}
/** World-space collision boxes keep the sheltered ground free (§4.1 / §7.2). */
export function canopyBodyBoxes(m: Extract<Module, { type: 'roof' }>): Array<{ x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }> {
  const posts = canopyPosts(m).map(({ x, y, height }) => {
    const [rx, ry] = rotateLocal(m.rot ?? 0, x, y)
    return { x0: m.x + .5 + rx - CANOPY_POST_RADIUS, x1: m.x + .5 + rx + CANOPY_POST_RADIUS,
      y0: m.y + .5 + ry - CANOPY_POST_RADIUS, y1: m.y + .5 + ry + CANOPY_POST_RADIUS, z0: m.z + 1, z1: m.z + 1 + height }
  })
  const footprint = trackCells(m)
  posts.push({ x0: Math.min(...footprint.map(c => c[0])), x1: Math.max(...footprint.map(c => c[0])) + 1,
    y0: Math.min(...footprint.map(c => c[1])), y1: Math.max(...footprint.map(c => c[1])) + 1,
    z0: m.z + 1 + TRUSS_ROOF_EAVE - CANOPY_ROOF_DROP - .2, z1: m.z + 1 + trussRoofTop(m.d) - CANOPY_ROOF_DROP })
  return posts
}
export function canopyPostCells(m: Extract<Module, { type: 'roof' }>): Array<[number, number]> {
  return canopyPosts(m).map(({ x, y }) => {
    const [rx, ry] = rotateLocal(m.rot ?? 0, x, y)
    return [m.x + rx, m.y + ry]
  })
}
export const DEFAULT_ROOF_FINISH = DEFAULT_MATERIAL
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
  return railing === 'sound-barrier-half' ? msg('half_height_noise_barrier') : railing === 'sound-barrier' ? msg('full_height_noise_barrier') : msg('railing')
}
export function pillarSupportsBridge(pillar: Module, track: Module): boolean {
  return pillar.type === 'pillar' && track.type === 'track' && track.cfg.bridge === true
    && pillar.z + pillar.cfg.height === track.z && trackCellAt(track, pillar.x, pillar.y, track.z)
}
export function extendedPillar(m: PillarModule, step = m.storeyHeight ?? PILLAR_STEP): PillarModule {
  return { ...m, cfg: { ...m.cfg, height: m.cfg.height + step } }
}
