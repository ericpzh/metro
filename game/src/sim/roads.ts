import { ROAD_LANE_WIDTH } from './constants.ts'
// Road surfaces and ambient traffic extend the street plane (§4.1, §9.5).
import type { Module, StationData } from './types.ts'
export type Road = Extract<Module, { type: 'road' }>
export function roadLayout(road: Road) {
  const acrossX = (road.rot ?? 0) % 2 === 0
  const width = acrossX ? road.w : road.d
  const length = acrossX ? road.d : road.w
  const lanes = road.cfg.direction === 'two-way' ? Math.floor(width / (ROAD_LANE_WIDTH * 2)) * 2 : Math.floor(width / ROAD_LANE_WIDTH)
  return { acrossX, width, length, lanes, laneWidth: width / Math.max(1, lanes) }
}
export function roadPoint(r: Road, across: number, along: number): [number, number] {
  return (r.rot ?? 0) % 2 === 0 ? [r.x + across, r.y + along] : [r.x + along, r.y + across]
}
/** Clip ink against every overlapping road at the same elevation, including T junctions. */
export function roadInkIntervals(r: Road, modules: readonly Module[], across: number, junctionMargin = 0): Array<[number, number]> {
  const { acrossX, length } = roadLayout(r)
  let spans: Array<[number, number]> = [[0, length]]
  for (const other of modules) {
    if (other.type !== 'road' || other.id === r.id || other.z !== r.z) continue
    // Shared caps on collinear segments keep continuous ink. Draw their overlap
    // once, owned by the stable earlier segment, rather than erasing both sides.
    if(roadLayout(other).acrossX===acrossX && (acrossX?other.x===r.x&&other.w===r.w:other.y===r.y&&other.d===r.d) && other.id>r.id) continue
    const cross = (acrossX ? r.x : r.y) + across
    const cross0 = acrossX ? other.x : other.y
    const cross1 = cross0 + (acrossX ? other.w : other.d)
    if (cross < cross0 || cross > cross1) continue
    const margin=roadLayout(other).acrossX!==acrossX?junctionMargin:0
    const lo = (acrossX ? other.y - r.y : other.x - r.x)-margin
    const hi = lo + (acrossX ? other.d : other.w)+margin*2
    spans = spans.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b] as [number, number]] : [
      ...(a < lo ? [[a, lo] as [number, number]] : []),
      ...(hi < b ? [[hi, b] as [number, number]] : []),
    ])
  }
  return spans
}
export function roadFromDrag(a: readonly number[], b: readonly number[], rot: number, direction: Road['cfg']['direction'], id: string): Road {
  const w = Math.abs(a[0] - b[0]) + 1, d = Math.abs(a[1] - b[1]) + 1
  return { id, type: 'road', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), z: a[2],
    w: rot % 2 ? d : w, d: rot % 2 ? w : d,
    rot: ((w > d ? 1 : 0) + rot) % 4, cfg: { direction } }
}
/** Stable per-road selection; ambient traffic never consumes the passenger RNG. */
export function roadHash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  // Avalanche before modulo selection: FNV's low bit correlates spawn/type rolls.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
/** Roads cut pedestrian paths on their own floor only; elevated decks remain independent. */
export function roadContainsPoint(roads: readonly Road[], x: number, y: number, floorZ: number): boolean {
  return roads.some(r => r.z === floorZ && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d)
}
/** Clip the entire movement segment against each road, so corners and shoves cannot cross it. */
export function roadMoveClear(roads: readonly Road[], x: number, y: number, nx: number, ny: number, floorZ: number): boolean {
  for (const r of roads) {
    if (r.z !== floorZ) continue
    let enter = 0, exit = 1
    for (const [start, end, lo, hi] of [[x, nx, r.x, r.x + r.w], [y, ny, r.y, r.y + r.d]]) {
      const delta = end - start
      if (Math.abs(delta) < 1e-12) {
        if (start <= lo || start >= hi) { enter = 1; exit = 0; break }
      } else {
        const a = (lo - start) / delta, b = (hi - start) / delta
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b))
      }
    }
    if (enter < exit && exit > 0 && enter < 1) return false
  }
  return true
}

/** Rendering dependencies only: roads still invalidate pedestrian routing. */
export function roadsOnlyChange(before: StationData, after: StationData): boolean {
  if (before.cells.length !== after.cells.length || before.cells.some((c, i) => c !== after.cells[i] && JSON.stringify(c) !== JSON.stringify(after.cells[i]))) return false
  const { cells: _bc, modules: _bm, ...bm } = before, { cells: _ac, modules: _am, ...am } = after
  if (JSON.stringify(bm) !== JSON.stringify(am)) return false
  const next = new Map(after.modules.map(m => [m.id, m]))
  let changed = false
  for (const m of before.modules) {
    const n = next.get(m.id); next.delete(m.id)
    if (m === n || (n && JSON.stringify(m) === JSON.stringify(n))) continue
    if (m.type !== 'road' || (n && n.type !== 'road')) return false
    changed = true
  }
  for (const m of next.values()) { if (m.type !== 'road') return false; changed = true }
  return changed
}
