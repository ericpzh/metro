// Shared deterministic routing policy, stable tile keys, integer-millisecond scoring,
// standing occupancy and soft tile claims (design/crowd-routing-plan.md §4).
// Pure TypeScript: mirrored bit-for-bit in Unity Metro.Sim (StationSparsePolicy.cs).
import {
  SPARSE_CLAIM_CAP_MS,
  SPARSE_CLAIM_PENALTY_MS,
  SPARSE_CLAIM_STEPS,
  SPARSE_CLAIM_TTL_TICKS,
  SPARSE_DENSITY_ADJACENT_MS,
  SPARSE_DENSITY_CAP_MS,
  SPARSE_DENSITY_DIRECT_MS,
  SPARSE_JITTER_MOD_MS,
  SPARSE_SECTOR_SIZE,
  SPARSE_TURN_PENALTY_MS,
} from './sparseConstants.ts'
import type { StationGraph } from './station.ts'

export type RoutingMode = 'sparse' | 'legacy'

export const INF_MS = 0x3fffffff

/** Round nonnegative seconds to integer milliseconds, half up (matches C# Math.Floor(s * 1000 + 0.5)). */
export function toMs(seconds: number): number {
  if (!Number.isFinite(seconds)) return INF_MS
  if (seconds <= 0) return 0
  const ms = Math.floor(seconds * 1000 + 0.5)
  return ms >= INF_MS ? INF_MS : ms
}

/** Mathematical floor division so negative coordinates land in the right 16×16 sector. */
export function floorDiv(value: number, divisor: number): number {
  const q = Math.trunc(value / divisor)
  const r = value - q * divisor
  return r < 0 ? q - 1 : q
}

const XY_BIAS = 32768
const XY_SPAN = 65536
const Z2_BIAS = 1024

/**
 * Lossless, order-preserving 43-bit stable tile key: `(tz2, tx, ty)` lexicographical order.
 * `tz2 = Math.round((nodeZ - 1) * 2)` preserves both integer floors and half-storey stair landings.
 */
export function packTileKey(tx: number, ty: number, tz2: number): number {
  return ((tz2 + Z2_BIAS) * XY_SPAN + (tx + XY_BIAS)) * XY_SPAN + (ty + XY_BIAS)
}

export function unpackTileKey(key: number): { tx: number; ty: number; tz2: number } {
  const tyShifted = key % XY_SPAN
  const rem = Math.floor(key / XY_SPAN)
  const txShifted = rem % XY_SPAN
  const tz2Shifted = Math.floor(rem / XY_SPAN)
  return {
    tx: txShifted - XY_BIAS,
    ty: tyShifted - XY_BIAS,
    tz2: tz2Shifted - Z2_BIAS,
  }
}

export function tileCoordsOfNode(graph: StationGraph, node: number): { tx: number; ty: number; tz2: number } {
  const tx = Math.floor(graph.nodeX[node])
  const ty = Math.floor(graph.nodeY[node])
  const tz2 = Math.round((graph.nodeZ[node] - 1) * 2)
  return { tx, ty, tz2 }
}

export function tileKeyOfNode(graph: StationGraph, node: number): number {
  const tx = Math.floor(graph.nodeX[node])
  const ty = Math.floor(graph.nodeY[node])
  const tz2 = Math.round((graph.nodeZ[node] - 1) * 2)
  return packTileKey(tx, ty, tz2)
}

const SECTOR_BIAS = 2048
const SECTOR_SPAN = 4096

/** Order-preserving stable sector key for `(sx, sy, tz2)` using floor division by 16. */
export function packSectorKey(sx: number, sy: number, tz2: number): number {
  return ((tz2 + Z2_BIAS) * SECTOR_SPAN + (sx + SECTOR_BIAS)) * SECTOR_SPAN + (sy + SECTOR_BIAS)
}

export function unpackSectorKey(key: number): { sx: number; sy: number; tz2: number } {
  const syShifted = key % SECTOR_SPAN
  const rem = Math.floor(key / SECTOR_SPAN)
  const sxShifted = rem % SECTOR_SPAN
  const tz2Shifted = Math.floor(rem / SECTOR_SPAN)
  return {
    sx: sxShifted - SECTOR_BIAS,
    sy: syShifted - SECTOR_BIAS,
    tz2: tz2Shifted - Z2_BIAS,
  }
}

export function sectorOfTile(tx: number, ty: number, tz2: number): { sx: number; sy: number; tz2: number; key: number } {
  const sx = floorDiv(tx, SPARSE_SECTOR_SIZE)
  const sy = floorDiv(ty, SPARSE_SECTOR_SIZE)
  return { sx, sy, tz2, key: packSectorKey(sx, sy, tz2) }
}

/** Exact 32-bit unsigned mix shared between TypeScript and C# (Murmur3 finalizer). */
export function hash32Init(seed: number): number {
  return ((seed | 0) ^ 0x9e3779b9) >>> 0
}

export function hash32Mix(h: number, v: number): number {
  let x = ((h >>> 0) ^ (v >>> 0)) >>> 0
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x >>> 0
}

export function hash32Tile(seed: number, tx: number, ty: number, tz2: number): number {
  let h = hash32Init(seed)
  h = hash32Mix(h, tx)
  h = hash32Mix(h, ty)
  h = hash32Mix(h, tz2)
  return h
}

export function hash32Jitter(seed: number, agentId: number, segmentSequence: number, tx: number, ty: number, tz2: number): number {
  let h = hash32Init(seed)
  h = hash32Mix(h, agentId)
  h = hash32Mix(h, segmentSequence)
  h = hash32Mix(h, tx)
  h = hash32Mix(h, ty)
  h = hash32Mix(h, tz2)
  return h % SPARSE_JITTER_MOD_MS
}

/** Eight cardinal/diagonal octants (0..7), or -1 for zero displacement. */
export function octantOf(dx: number, dy: number): number {
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0
  if (sx === 0 && sy === 0) return -1
  if (sx > 0) return sy > 0 ? 1 : sy < 0 ? 7 : 0
  if (sx < 0) return sy > 0 ? 3 : sy < 0 ? 5 : 4
  return sy > 0 ? 2 : 6
}

export function shortestOctantDifference(a: number, b: number): number {
  if (a < 0 || b < 0) return 0
  const d = Math.abs(a - b) & 7
  return d > 4 ? 8 - d : d
}

/**
 * Exact Section 4.3 `scoreTile` in integer milliseconds:
 *   direct   = occupancy.otherBodiesOn(tile, agent)
 *   adjacent = occupancy.meanOtherBodiesOnPlainNeighbours(tile, agent)
 *   density  = min(2500, 500 * direct + roundHalfUp(250 * adjacent))
 *   reserved = min(1300, 650 * claims.countOtherAgentsOn(tile, agent))
 *   turn     = heading >= 0 ? 50 * shortestOctantDifference(heading, dir(current -> tile)) : 0
 *   jitter   = hash32(stationSeed, agentId, segmentSequence, tile.tx, tile.ty, tile.tz2) mod 100
 *   score    = walkCostMs + fieldMs + density + reserved + turn + jitter
 */
export function scoreTileMs(
  walkCostMs: number,
  fieldMs: number,
  directOtherBodies: number,
  adjacentOtherSum: number,
  adjacentPlainCount: number,
  otherClaims: number,
  heading: number,
  moveOctant: number,
  stationSeed: number,
  agentId: number,
  segmentSequence: number,
  tileTx: number,
  tileTy: number,
  tileTz2: number,
  opts?: { useDensity?: boolean; useBias?: boolean; useClaims?: boolean },
): number {
  const useDensity = opts?.useDensity ?? true
  const useBias = opts?.useBias ?? true
  const useClaims = opts?.useClaims ?? true

  let density = 0
  if (useDensity) {
    // Exact integer half-up rounding for 250 * (adjacentOtherSum / adjacentPlainCount):
    // floor((250 * sum * 2 + count) / (2 * count)).
    const adjTerm = adjacentPlainCount > 0
      ? Math.floor((SPARSE_DENSITY_ADJACENT_MS * 2 * adjacentOtherSum + adjacentPlainCount) / (2 * adjacentPlainCount))
      : 0
    const rawDensity = SPARSE_DENSITY_DIRECT_MS * directOtherBodies + adjTerm
    density = rawDensity > SPARSE_DENSITY_CAP_MS ? SPARSE_DENSITY_CAP_MS : rawDensity
  }

  let reserved = 0
  if (useClaims && otherClaims > 0) {
    const rawClaims = SPARSE_CLAIM_PENALTY_MS * otherClaims
    reserved = rawClaims > SPARSE_CLAIM_CAP_MS ? SPARSE_CLAIM_CAP_MS : rawClaims
  }

  let turn = 0
  let jitter = 0
  if (useBias) {
    if (heading >= 0 && moveOctant >= 0) {
      turn = SPARSE_TURN_PENALTY_MS * shortestOctantDifference(heading, moveOctant)
    }
    jitter = hash32Jitter(stationSeed, agentId, segmentSequence, tileTx, tileTy, tileTz2)
  }

  return walkCostMs + fieldMs + density + reserved + turn + jitter
}

/** Per-tick standing/queuing body count per walk node. */
export class StandingOccupancy {
  counts: Int32Array

  constructor(nodeCount: number) {
    this.counts = new Int32Array(nodeCount)
  }

  resize(nodeCount: number): void {
    if (this.counts.length !== nodeCount) this.counts = new Int32Array(nodeCount)
    else this.counts.fill(0)
  }

  clear(): void {
    this.counts.fill(0)
  }

  add(node: number): void {
    if (node >= 0 && node < this.counts.length) this.counts[node]++
  }

  otherBodiesOn(node: number, selfNode: number): number {
    if (node < 0 || node >= this.counts.length) return 0
    const c = this.counts[node] - (node === selfNode ? 1 : 0)
    return c > 0 ? c : 0
  }
}

interface AgentClaim {
  n0: number
  n1: number
  expiresTick: number
}

/**
 * Soft walking claims on the next 1–2 untraversed tiles per passenger.
 * Claims stay traversable (adding bounded score cost) and expire on traversal,
 * queue entry, invalidation, or short tick TTL.
 */
export class SoftClaimTable {
  private nodeCounts: Int32Array
  private byAgent = new Map<number, AgentClaim>()

  constructor(nodeCount: number) {
    this.nodeCounts = new Int32Array(nodeCount)
  }

  resize(nodeCount: number): void {
    this.nodeCounts = new Int32Array(nodeCount)
    this.byAgent.clear()
  }

  clear(): void {
    this.nodeCounts.fill(0)
    this.byAgent.clear()
  }

  /** Remap existing claims onto a rebuilt graph, dropping claims on deleted tiles. */
  remap(newNodeCount: number, mapOldToNew: (oldNode: number) => number): void {
    const nextCounts = new Int32Array(newNodeCount)
    for (const [agentId, claim] of this.byAgent) {
      const m0 = claim.n0 >= 0 ? mapOldToNew(claim.n0) : -1
      const m1 = claim.n1 >= 0 ? mapOldToNew(claim.n1) : -1
      if (m0 < 0 && m1 < 0) {
        this.byAgent.delete(agentId)
        continue
      }
      claim.n0 = m0
      claim.n1 = m1 === m0 ? -1 : m1
      if (claim.n0 >= 0) nextCounts[claim.n0]++
      if (claim.n1 >= 0) nextCounts[claim.n1]++
    }
    this.nodeCounts = nextCounts
  }

  expire(currentTick: number): void {
    for (const [agentId, claim] of this.byAgent) {
      if (claim.expiresTick <= currentTick) {
        if (claim.n0 >= 0 && claim.n0 < this.nodeCounts.length) this.nodeCounts[claim.n0] = Math.max(0, this.nodeCounts[claim.n0] - 1)
        if (claim.n1 >= 0 && claim.n1 < this.nodeCounts.length) this.nodeCounts[claim.n1] = Math.max(0, this.nodeCounts[claim.n1] - 1)
        this.byAgent.delete(agentId)
      }
    }
  }

  release(agentId: number): void {
    const old = this.byAgent.get(agentId)
    if (!old) return
    if (old.n0 >= 0 && old.n0 < this.nodeCounts.length) this.nodeCounts[old.n0] = Math.max(0, this.nodeCounts[old.n0] - 1)
    if (old.n1 >= 0 && old.n1 < this.nodeCounts.length) this.nodeCounts[old.n1] = Math.max(0, this.nodeCounts[old.n1] - 1)
    this.byAgent.delete(agentId)
  }

  /** Refresh claims for the next up to 2 untraversed tiles of an agent's segment. */
  refresh(agentId: number, step0: number, step1: number, currentTick: number, ttl = SPARSE_CLAIM_TTL_TICKS): void {
    const n0 = step0 >= 0 && step0 < this.nodeCounts.length ? step0 : -1
    const n1 = SPARSE_CLAIM_STEPS >= 2 && step1 >= 0 && step1 < this.nodeCounts.length && step1 !== n0 ? step1 : -1
    const old = this.byAgent.get(agentId)
    if (old) {
      if (old.n0 === n0 && old.n1 === n1) {
        old.expiresTick = currentTick + ttl
        return
      }
      if (old.n0 >= 0 && old.n0 < this.nodeCounts.length) this.nodeCounts[old.n0] = Math.max(0, this.nodeCounts[old.n0] - 1)
      if (old.n1 >= 0 && old.n1 < this.nodeCounts.length) this.nodeCounts[old.n1] = Math.max(0, this.nodeCounts[old.n1] - 1)
      if (n0 < 0 && n1 < 0) {
        this.byAgent.delete(agentId)
        return
      }
      old.n0 = n0
      old.n1 = n1
      old.expiresTick = currentTick + ttl
      if (n0 >= 0) this.nodeCounts[n0]++
      if (n1 >= 0) this.nodeCounts[n1]++
      return
    }
    if (n0 < 0 && n1 < 0) return
    this.byAgent.set(agentId, { n0, n1, expiresTick: currentTick + ttl })
    if (n0 >= 0) this.nodeCounts[n0]++
    if (n1 >= 0) this.nodeCounts[n1]++
  }

  countOtherAgentsOn(node: number, agentId: number): number {
    if (node < 0 || node >= this.nodeCounts.length) return 0
    let c = this.nodeCounts[node]
    const own = this.byAgent.get(agentId)
    if (own && (own.n0 === node || own.n1 === node)) c--
    return c > 0 ? c : 0
  }

  get activeCount(): number {
    return this.byAgent.size
  }
}
