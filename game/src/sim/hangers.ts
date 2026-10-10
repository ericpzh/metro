// Steel hanging supports, GAME-SPEC §5.7–5.8. Shared placement/model dimensions.
import { rotateLocal, trackCells } from './track.ts'
import { TRUSS_ROOF_BASE, TRUSS_ROOF_EAVE, trussRoofRidge } from './structures.ts'
import { signBoardsOf, signBoardsPanel } from './sign.ts'
import type { Cell, Module } from './types.ts'

export type HangerModule = Extract<Module, { type: 'hanger' }>
export const HANGER_LENGTHS = [4, 6, 8] as const
export const HANGER_BAR_TOP = 4
export const HANGER_POST_BAR_TOP = 3
export const HANGER_BAR_DEPTH = 0.2
export const HANGER_POST_WIDTH = 0.18
// The post meets the rear of the bar, leaving the hanging panels clear of its shaft.
export const HANGER_POST_OFFSET = 0.17
export const HANGER_LENGTH_LABELS = ['短', '中', '长'] as const

export function hangerCells(m: HangerModule): Array<[number, number]> {
  return Array.from({ length: m.w }, (_, i) => {
    const [dx, dy] = rotateLocal(m.rot, i, 0)
    return [m.x + dx, m.y + dy]
  })
}

export function hangerPostCells(m: HangerModule): Array<[number, number]> {
  return m.cfg.mount === 'post' ? hangerCells(m).slice(m.w / 2 - 1, m.w / 2 + 1) : []
}

export function hangerBoxes(m: HangerModule) {
  const barTop = m.cfg.mount === 'roof' ? HANGER_BAR_TOP : HANGER_POST_BAR_TOP
  const [dx, dy] = rotateLocal(m.rot, (m.w - 1) / 2, 0)
  const cx = m.x + 0.5 + dx
  const cy = m.y + 0.5 + dy
  const sideways = Math.abs((m.rot ?? 0) % 2) === 1
  const halfX = (sideways ? HANGER_BAR_DEPTH : m.w) / 2
  const halfY = (sideways ? m.w : HANGER_BAR_DEPTH) / 2
  const top = m.z + 1 + barTop
  const boxes = [{ x0: cx - halfX, x1: cx + halfX, y0: cy - halfY, y1: cy + halfY, z0: top - HANGER_BAR_DEPTH, z1: top }]
  if (m.cfg.mount === 'post') {
    const half = HANGER_POST_WIDTH / 2
    const [px, py] = rotateLocal(m.rot, 0, HANGER_POST_OFFSET)
    boxes.push({ x0: cx + px - half, x1: cx + px + half, y0: cy + py - half, y1: cy + py + half, z0: m.z + 1, z1: top })
    boxes.push({ x0: cx + px - 0.18, x1: cx + px + 0.18, y0: cy + py - 0.18, y1: cy + py + 0.18, z0: m.z + 1, z1: m.z + 1.05 })
  }
  return boxes
}

/** Height of actual roof backing at a suspension point, including shell roofs. */
export function hangerRoofZ(cells: readonly Cell[], modules: readonly Module[], m: HangerModule, x: number, y: number): number | undefined {
  const slab = cells.find((c) => c.fill === 'solid' && c.x === x && c.y === y && c.z === m.z + 4)
  if (slab) return slab.z
  for (const roof of modules) {
    if (roof.type !== 'roof' || roof.z !== m.z || !trackCells(roof).some(([rx, ry]) => rx === x && ry === y)) continue
    if (!roof.cfg.variant) return roof.z + 1 + TRUSS_ROOF_BASE
    const [, localY] = rotateLocal(-(roof.rot ?? 0), x - roof.x, y - roof.y)
    const ridge = trussRoofRidge(roof.d)
    const height = ridge - (ridge - TRUSS_ROOF_EAVE) * Math.abs(localY - (roof.d - 1) / 2) / (roof.d / 2)
    return roof.z + 1 + height
  }
  return undefined
}

export function hangerRoofMissing(cells: readonly Cell[], modules: readonly Module[], m: HangerModule): boolean {
  if (m.cfg.mount === 'post') return false
  const run = hangerCells(m)
  return [run[0]!, run[run.length - 1]!].some(([x, y]) => hangerRoofZ(cells, modules, m, x, y) === undefined)
}

/** Hanging rods must land on the bar centreline, rather than beside the beam. */
export function hangerSupports(hanger: Module, item: Module): boolean {
  if (hanger.type !== 'hanger' || hanger.z !== item.z) return false
  if (item.type !== 'tv' && item.type !== 'clock' && item.type !== 'cctv' && !(item.type === 'sign' && item.cfg.mount !== 'wall')) return false
  if (!hangerCells(hanger).some(([x, y]) => x === item.x && y === item.y)) return false
  // A sign/TV uses two suspension rods across its face; keep both on the bar.
  if (item.type !== 'clock' && ((item.rot ?? 0) - (hanger.rot ?? 0)) % 2 !== 0) return false
  const [along] = rotateLocal(-(hanger.rot ?? 0), item.x - hanger.x, item.y - hanger.y)
  const rodHalf = item.type === 'sign' ? Math.max(0.22, signBoardsPanel(signBoardsOf(item.cfg)).w / 2 - 0.35) + 0.08 : item.type === 'tv' ? 0.5 : item.type === 'cctv' ? 0.18 : 0.075
  return along + 0.5 - rodHalf >= 0 && along + 0.5 + rodHalf <= hanger.w
}

/** Roof-mounted fittings rise with their bar; the floor post version stays put. */
export function hangerLiftFor(modules: readonly Module[], item: Module): number {
  return modules.some((m) => m.type === 'hanger' && m.cfg.mount === 'roof' && hangerSupports(m, item)) ? 1 : 0
}
