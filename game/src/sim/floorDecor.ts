import type { Module, LineDef } from './types.ts'
import { rotateLocal } from './track.ts'
import { doorRunOffsets, STOCK } from './stock.ts'
import { PSD_FULL_DOOR_WIDTH_SCALE } from './constants.ts'

export type TactileVariant = 'guide' | 'warning'
export type FloorMarkVariant = 'boarding' | 'waiting' | 'direction'
export type FloorDecorModule = Extract<Module, { type: 'ac-unit' | 'electrical-cabinet' | 'tactile' | 'floor-mark' }>

/** Metre dimensions shared by the floor models and placement verdict (§9.5). */
export function floorDecorSpec(m: FloorDecorModule): { w: number; d: number; h: number } {
  switch (m.type) {
    case 'ac-unit': return { w: 3, d: 2, h: 2.7 }
    case 'electrical-cabinet': return { w: 3, d: 1, h: 2.2 }
    case 'tactile': return { w: 1, d: 1, h: 0.012 }
    case 'floor-mark': return m.cfg.variant === 'direction'
      ? { w: 1, d: 2, h: 0.006 }
      : { w: 3, d: m.cfg.variant === 'waiting' ? 2 : 0.25, h: 0.006 }
  }
}

export function isFloorSticker(m: Module): m is Extract<Module, { type: 'tactile' | 'floor-mark' }> {
  return m.type === 'tactile' || m.type === 'floor-mark'
}

/** The pointer anchors the first cell; each following cell rotates with the model. */
export function floorDecorCells(m: FloorDecorModule): Array<[number, number]> {
  if (m.type === 'floor-mark') {
    const b = floorDecorBounds(m)
    const out: Array<[number, number]> = []
    for (let x = Math.floor(b.x0 + 1e-6); x < Math.ceil(b.x1 - 1e-6); x++) for (let y = Math.floor(b.y0 + 1e-6); y < Math.ceil(b.y1 - 1e-6); y++) out.push([x, y])
    return out
  }
  const { w, d } = floorDecorSpec(m)
  const out: Array<[number, number]> = []
  for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) {
    const [dx, dy] = rotateLocal(m.rot ?? 0, x, y)
    out.push([m.x + dx, m.y + dy])
  }
  return out
}

/** Exact vinyl bounds, including its sub-cell screen-door alignment. */
export function floorDecorBounds(m: FloorDecorModule): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } {
  const { w, d, h } = floorDecorSpec(m)
  const cy = (Math.ceil(d) - 1) / 2
  const offset = m.type === 'floor-mark' ? m.cfg.offset : undefined
  const corners = [-w / 2, w / 2].flatMap((x) => [-d / 2, d / 2].map((y) => rotateLocal(m.rot, x + (w - 1) / 2, y + cy)))
  return { x0: m.x + 0.5 + (offset?.x ?? 0) + Math.min(...corners.map(([x]) => x)),
    x1: m.x + 0.5 + (offset?.x ?? 0) + Math.max(...corners.map(([x]) => x)),
    y0: m.y + 0.5 + (offset?.y ?? 0) + Math.min(...corners.map(([, y]) => y)),
    y1: m.y + 0.5 + (offset?.y ?? 0) + Math.max(...corners.map(([, y]) => y)), z0: m.z + 1, z1: m.z + 1 + h }
}

/** Warning squares extend to every connected neighbor: L, T and cross need no separate tiles. */
export function tactileArms(m: Extract<Module, { type: 'tactile' }>, modules: readonly Module[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const neighbor = tactileAt(modules, m.x + dx, m.y + dy, m.z)
    if (neighbor?.type !== 'tactile') continue
    if (neighbor.cfg.variant === 'warning' || ((neighbor.rot ?? 0) % 2 === 0 ? dy === 0 : dx === 0)) {
      out.push(rotateLocal(-(m.rot ?? 0), dx, dy))
    }
  }
  return out
}

export function floorMarkLine(m: Extract<Module, { type: 'floor-mark' }>, lines: readonly LineDef[]): { name: string; colour: string; id: string } {
  const fallback = { id: '5', name: '5号线', colour: '#c8102e' }
  // Unbound thumbnails and older saves open on Line 5; placed pieces carry an explicit binding.
  if (!m.cfg.line) return lines.find((l) => l.id === '5') ?? fallback
  return lines.find((l) => l.id === m.cfg.line) ?? lines.find((l) => l.id === '5') ?? lines[0] ?? fallback
}

/** Same opening cadence and clipping as PsdModel; snap only within 1.5 m on the same floor. */
export function snapBoardingMark(m: Extract<Module, { type: 'floor-mark' }>, modules: readonly Module[], lines: readonly LineDef[]): Extract<Module, { type: 'floor-mark' }> {
  if (m.cfg.variant === 'waiting') {
    // Existing boarding ink takes priority, including manually placed strips.
    let target: Extract<Module, { type: 'floor-mark' }> | undefined
    let distance = 2.5
    for (const mark of modules) {
      if (mark.type !== 'floor-mark' || mark.cfg.variant !== 'boarding' || mark.z !== m.z) continue
      const b = floorDecorBounds(mark)
      const d = Math.hypot((b.x0 + b.x1) / 2 - m.x - 0.5, (b.y0 + b.y1) / 2 - m.y - 0.5)
      if (d < distance) { distance = d; target = mark }
    }
    if (!target) {
      const door = snapBoardingMark({ ...m, cfg: { ...m.cfg, variant: 'boarding' } }, modules, lines)
      if (!door.cfg.edgeId) return m
      target = door
    }
    const b = floorDecorBounds(target)
    // Queue's front edge sits 2.5 cm behind the 25 cm boarding strip.
    const [dx, dy] = rotateLocal(target.rot, 1, 0.5 + 1.15)
    return { ...m, rot: target.rot, cfg: { ...m.cfg, edgeId: target.cfg.edgeId,
      offset: { x: (b.x0 + b.x1) / 2 - m.x - 0.5 - dx, y: (b.y0 + b.y1) / 2 - m.y - 0.5 - dy } } }
  }
  if (m.cfg.variant !== 'boarding') return m
  let best: { x: number; y: number; rot: number; edgeId: string } | undefined
  let distance = 1.5
  for (const edge of modules) {
    if (edge.type !== 'platform-edge' || edge.z !== m.z) continue
    const line = lines.find((l) => l.id === edge.cfg.line) ?? lines[0]
    const stock = line?.stock ?? 'B'
    const cars = line?.cars ?? 6
    const rail = modules.find((r) => r.id === edge.cfg.from)
    const bed = rail?.type === 'track' ? rail : undefined
    const width = bed?.w ?? edge.w
    const i0 = bed ? rotateLocal(-(bed.rot ?? 0), edge.x - bed.x, edge.y - bed.y)[0] : (width - edge.w) / 2
    const doorWidth = STOCK[stock].doorWidth * ((edge.cfg.psd ?? line?.psd) === 'half' ? 1 : PSD_FULL_DOOR_WIDTH_SCALE)
    const toward = edge.cfg.side === 'right' ? 1 : -1
    for (const at of doorRunOffsets({ stock, cars }, width)) {
      const dx = at - i0 - 0.5
      if (dx - doorWidth / 2 <= -0.4 || dx + doorWidth / 2 >= edge.w - 0.6) continue
      const [ox, oy] = rotateLocal(edge.rot, dx, toward * 0.09)
      const x = edge.x + 0.5 + ox
      const y = edge.y + 0.5 + oy
      const d = Math.hypot(x - (m.x + 0.5), y - (m.y + 0.5))
      if (d < distance) { distance = d; best = { x, y, rot: ((edge.rot ?? 0) + (toward < 0 ? 2 : 0)) % 4, edgeId: edge.id } }
    }
  }
  if (!best) return m
  const [dx, dy] = rotateLocal(best.rot, 1, 0)
  return { ...m, rot: best.rot, cfg: { ...m.cfg, edgeId: best.edgeId, offset: { x: best.x - (m.x + 0.5) - dx, y: best.y - (m.y + 0.5) - dy } } }
}

export function tactileAt(modules: readonly Module[], x: number, y: number, z: number, variant?: TactileVariant): Module | undefined {
  return modules.find((m) => m.type === 'tactile' && m.x === x && m.y === y && m.z === z && (!variant || m.cfg.variant === variant))
}
