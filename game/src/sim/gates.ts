// Fare-gate policy — GAME-SPEC.md §4.5 and §7.1.
//
// A gate is one of three kinds: entry only, exit only, or two-way. A one-way
// gate is a hard filter: an agent crossing the wrong way may not use it, and the
// walk graph does not even offer the edge, so routing sends it to a legal gate.
// A two-way turnstile is a single lane, so it passes one direction at a time:
// the first arrival fixes the lane, everyone queued behind in that direction
// goes through, and only when that side is empty can the lane flip — first come,
// first served. The pure predicates live here so the graph, the server loop and
// the tests all agree on the rule.

import type { GateDir, GateMode } from './types.ts'

/**
 * May a gate of `mode` pass a walker crossing in `dir`? `dir === 0` means the
 * step does not actually cross the fare line (both sides the same zone), so no
 * gate can be wrong about it — every mode passes it.
 */
export function gateAllows(mode: GateMode, dir: GateDir): boolean {
  if (dir === 0 || mode === 'both') return true
  return mode === 'in' ? dir === 1 : dir === -1
}

/**
 * The same rule, but for a two-way lane that is already committed: while `lane`
 * is not idle, only the committed direction (and directionless walkers) may be
 * served. A one-way gate ignores `lane` and always applies its own direction.
 */
export function gateLaneAllows(mode: GateMode, lane: GateDir, dir: GateDir): boolean {
  if (mode === 'both') return lane === 0 || dir === 0 || dir === lane
  return gateAllows(mode, dir)
}

/**
 * Index of the next queued agent a gate may serve, or -1 when every queued
 * agent is of the blocked direction. `dirs` is the queue in arrival order.
 * The caller removes the returned agent and, for a two-way gate, commits the
 * lane to that agent's direction.
 */
export function nextGateIndex(dirs: readonly GateDir[], mode: GateMode, lane: GateDir): number {
  for (let i = 0; i < dirs.length; i++) {
    if (gateLaneAllows(mode, lane, dirs[i])) return i
  }
  return -1
}
