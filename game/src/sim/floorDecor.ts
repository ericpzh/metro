import { msg } from './i18n.ts'
import type { Module, LineDef } from './types.ts'
import { rotateLocal } from './track.ts'
import { doorRunOffsets, doorWidthAt, trainScaleForStorey } from './stock.ts'
import { PSD_FULL_DOOR_WIDTH_SCALE } from './constants.ts'
import { registerDocumentCache } from './documentCaches.ts'

export type TactileVariant = 'guide' | 'warning' | 'warning-strip'
export type FloorMarkVariant = 'boarding' | 'waiting' | 'direction'
export type FloorDecorModule = Extract<Module, { type: 'court' | 'ac-unit' | 'electrical-cabinet' | 'tactile' | 'floor-mark' }>

/** Metre dimensions shared by the floor models and placement verdict (§9.5). */
export function floorDecorSpec(m: FloorDecorModule): { w: number; d: number; h: number } {
  switch (m.type) {
    case 'court': return m.cfg.variant === 'divider' ? { w: 2, d: 1, h: 1 } : { w: 14, d: 7, h: m.cfg.variant === 'badminton' ? 1.6 : 0.97 }
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

/**
 * The warning square extends to every connected neighbor: L, T and cross need no
 * separate tiles. A warning strip already reaches both ends of its own run, so it
 * only grows a crosswise arm — and only toward a neighbor whose band really crosses
 * that shared edge. A junction square beside a strip stays unjoined for the same
 * reason it stays unjoined beside a guide: the square's arm would meet no band.
 */
export function tactileArms(m: Extract<Module, { type: 'tactile' }>, modules: readonly Module[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const strip = m.cfg.variant === 'warning-strip'
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const neighbor = tactileAt(modules, m.x + dx, m.y + dy, m.z)
    if (neighbor?.type !== 'tactile') continue
    const junction = neighbor.cfg.variant === 'warning'
    // A band crosses the shared edge only along its own spine; a junction square
    // reaches every edge with its own arm.
    const continues = (neighbor.rot ?? 0) % 2 === 0 ? dy === 0 : dx === 0
    if (strip ? junction || !continues : !junction && !continues) continue
    const [lx, ly] = rotateLocal(-(m.rot ?? 0), dx, dy)
    // The strip's own one-metre top already covers the run's shared edges.
    if (strip && ly === 0) continue
    out.push([lx, ly])
  }
  return out
}

export function floorMarkLine(m: Extract<Module, { type: 'floor-mark' }>, lines: readonly LineDef[]): { name: string; colour: string; id: string } {
  const fallback = { id: '5', name: msg('line_5'), colour: '#c8102e' }
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
    // The screen is cut open at the consist's *drawn* door centres, so the vinyl
    // has to repeat that same five-metre-profile scale. Without it every opening
    // drift grows with its distance from the consist centre (~1.7 m at either end
    // of a 173 m, eight-car platform) while the doors themselves stay put.
    const modelScale = line?.modelScale ?? trainScaleForStorey()
    const rail = modules.find((r) => r.id === edge.cfg.from)
    const bed = rail?.type === 'track' ? rail : undefined
    const width = bed?.w ?? edge.w
    const i0 = bed ? rotateLocal(-(bed.rot ?? 0), edge.x - bed.x, edge.y - bed.y)[0] : (width - edge.w) / 2
    const toward = edge.cfg.side === 'right' ? 1 : -1
    for (const at of doorRunOffsets({ stock, cars, modelScale }, width)) {
      const doorWidth = doorWidthAt({ stock, cars, modelScale }, at - width / 2) * ((edge.cfg.psd ?? line?.psd) === 'half' ? 1 : PSD_FULL_DOOR_WIDTH_SCALE)
      const dx = at - i0 - 0.5
      if (dx - doorWidth / 2 <= -0.4 || dx + doorWidth / 2 >= edge.w - 0.6) continue
      const [ox, oy] = rotateLocal(edge.rot, dx, toward * -0.02)
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

/** `realignSavedFloorMarks` tolerances, in metres. */
const DOOR_ALIGNED = 0.02
const LEGACY_CADENCE = 0.3

/**
 * Re-align a saved station's floor vinyl onto the screen's current doorways.
 *
 * The authors' demo saves were written by builds that cut their screen openings
 * without the line's `modelScale`, so their boarding strips still sit on the old
 * cadence: about a metre off mid-platform and past the 1.5 m snap radius at the
 * ends. `tools/bake-demo-station.mjs` runs this over the baked document, so a
 * re-load cannot undo the on-screen fix. Only ink that provably still sits on
 * the legacy cadence moves (within {@link LEGACY_CADENCE} of a legacy doorway);
 * ink already on a current doorway, or deliberately placed away from every
 * doorway, is left exactly where the save put it. Waiting lines are then
 * re-snapped behind their boarding strip, since a queue follows the ink.
 *
 * This is a data-curation step for the shipped examples, not a load-time repair:
 * the game still opens a save with the offsets it stored.
 */
export function realignSavedFloorMarks(
  modules: readonly Module[],
  lines: readonly LineDef[],
): { modules: readonly Module[]; boarding: number; waiting: number } {
  type DoorRun = { current: Array<[number, number]>; legacy: Array<[number, number]> }
  const runs = new Map<string, DoorRun>()
  for (const edge of modules) {
    if (edge.type !== 'platform-edge') continue
    const line = lines.find((l) => l.id === edge.cfg.line) ?? lines[0]
    if (!line) continue
    const rail = modules.find((r) => r.id === edge.cfg.from)
    const bed = rail?.type === 'track' ? rail : undefined
    const width = bed?.w ?? edge.w
    const i0 = bed ? rotateLocal(-(bed.rot ?? 0), edge.x - bed.x, edge.y - bed.y)[0] : (width - edge.w) / 2
    const toward = edge.cfg.side === 'right' ? 1 : -1
    const world = (offsets: number[]): Array<[number, number]> => offsets.map((at) => {
      const [ox, oy] = rotateLocal(edge.rot, at - i0 - 0.5, toward * -0.02)
      return [edge.x + 0.5 + ox, edge.y + 0.5 + oy]
    })
    runs.set(edge.id, {
      current: world(doorRunOffsets(line, width)),
      legacy: world(doorRunOffsets({ stock: line.stock, cars: line.cars }, width)),
    })
  }
  const nearest = (doors: ReadonlyArray<[number, number]>, centre: [number, number]): { index: number; distance: number } => {
    let index = -1, distance = Infinity
    doors.forEach((p, i) => {
      const d = Math.hypot(p[0] - centre[0], p[1] - centre[1])
      if (d < distance) { distance = d; index = i }
    })
    return { index, distance }
  }
  const centreOf = (m: Extract<Module, { type: 'floor-mark' }>): [number, number] => {
    const b = floorDecorBounds(m)
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]
  }
  const next = modules.slice()
  let boarding = 0
  modules.forEach((mod, i) => {
    if (mod.type !== 'floor-mark' || mod.cfg.variant !== 'boarding') return
    const edge = mod.cfg.edgeId ? modules.find((m) => m.id === mod.cfg.edgeId) : undefined
    if (!edge || edge.type !== 'platform-edge' || edge.z !== mod.z) return
    const run = runs.get(edge.id)
    if (!run) return
    const centre = centreOf(mod)
    if (nearest(run.current, centre).distance <= DOOR_ALIGNED) return
    const legacy = nearest(run.legacy, centre)
    const target = run.current[legacy.index]
    if (!target || legacy.distance > LEGACY_CADENCE) return
    const toward = edge.cfg.side === 'right' ? 1 : -1
    const rot = ((edge.rot ?? 0) + (toward < 0 ? 2 : 0)) % 4
    const [dx, dy] = rotateLocal(rot, 1, 0)
    next[i] = {
      ...mod,
      rot,
      cfg: { ...mod.cfg, edgeId: edge.id, offset: { x: target[0] - (mod.x + 0.5) - dx, y: target[1] - (mod.y + 0.5) - dy } },
    }
    boarding++
  })
  let waiting = 0
  modules.forEach((mod, i) => {
    if (mod.type !== 'floor-mark' || mod.cfg.variant !== 'waiting') return
    const snapped = snapBoardingMark(mod, next, lines)
    if (snapped === mod) return
    if ((snapped.rot ?? 0) === (mod.rot ?? 0) && JSON.stringify(snapped.cfg) === JSON.stringify(mod.cfg)) return
    next[i] = snapped
    waiting++
  })
  return { modules: boarding + waiting > 0 ? next : modules, boarding, waiting }
}

const tactileIndexes = new WeakMap<readonly Module[], Map<string, Extract<Module, { type: 'tactile' }>[]>>()

export function tactileAt(modules: readonly Module[], x: number, y: number, z: number, variant?: TactileVariant): Module | undefined {
  let index = tactileIndexes.get(modules)
  if (!index) {
    index = new Map()
    for (const module of modules) {
      if (module.type !== 'tactile') continue
      const key = `${module.x},${module.y},${module.z}`
      const entries = index.get(key) ?? []
      entries.push(module); index.set(key, entries)
    }
    tactileIndexes.set(modules, index)
  }
  return index.get(`${x},${y},${z}`)?.find(module => !variant || module.cfg.variant === variant)
}

registerDocumentCache((_cells, modules, _liveCells, liveModules) => {
  if (modules !== liveModules) tactileIndexes.delete(modules)
})
