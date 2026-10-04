// Fare-gate policy — GAME-SPEC.md §4.5, §5.2 and §7.1.
//
// A gate is one of three kinds: entry only, exit only, or two-way. A one-way
// gate is a hard filter: an agent crossing the wrong way may not use it, and the
// walk graph does not even offer the edge, so routing sends it to a legal gate.
// A two-way turnstile is a single lane, so it passes one direction at a time:
// the first arrival fixes the lane, everyone queued behind in that direction
// goes through, and only when that side is empty can the lane flip — first come,
// first served. The piece is also either a working **lane** or the **fence** that
// closes a run (`cfg.door`, toggled with Tab): a fence machine has no lane at all,
// so it is no gate and only carries a 围栏 run. Which hand the lane is on is not a
// setting — `R` turns the piece. The pure predicates live here so the graph, the
// renderer and the tests all agree on the rules.

import type { GateDir, GateDoor, GateDoorStored, GateMode } from './types.ts'
import { rotateLocal } from './track.ts'

/** The 闸机 choices in Tab order: the working lane (the default) and the fence. */
export const GATE_DOORS: readonly GateDoor[] = ['lane', 'fence']

/**
 * A gate's choice. A save written while the door *side* was a setting reads as a
 * lane whichever hand it named (the mirror is a rotation), and the old `none` as
 * the fence; a save from before the choice existed is a lane.
 */
export function gateDoorOf(gate: { cfg: { door?: GateDoorStored } }): GateDoor {
  const door = gate.cfg.door
  return door === 'fence' || door === 'none' ? 'fence' : 'lane'
}

/** The choice Tab steps to next. */
export function nextGateDoor(door: GateDoor | undefined): GateDoor {
  return GATE_DOORS[(GATE_DOORS.indexOf(door ?? 'lane') + 1) % GATE_DOORS.length]
}

/** True for a gate with a lane at all — a fence machine lets nobody through. */
export function gateHasLane(gate: { cfg: { door?: GateDoorStored } }): boolean {
  return gateDoorOf(gate) === 'lane'
}

/**
 * The unit world offset from a gate's cell to the side its solid machine body
 * stands on, or null for a fence machine, whose body is on one half with fence on
 * the other, so it presents a solid face on every side.
 *
 * The body is always built on the cell's local −x half; `R` turns the piece, so
 * the offset is that half turned with it, and a 90°-turned gate bolts its machine
 * to the matching world side.
 */
export function gateMachineSide(gate: { rot?: number; cfg: { door?: GateDoorStored } }): [number, number] | null {
  if (!gateHasLane(gate)) return null
  return rotateLocal(gate.rot, -1, 0)
}

/**
 * True when a fence run beside a gate may butt into the machine at the neighbour
 * offset (`dx`, `dy`) — the body faces that way, or the machine is a fence one and
 * solid all round. A fence on the **lane** side is not joined: it ends at the
 * doorway with its own end post, so the run is not welded across the opening.
 */
export function gateSolidFaces(gate: { rot?: number; cfg: { door?: GateDoorStored } }, dx: number, dy: number): boolean {
  const side = gateMachineSide(gate)
  if (!side) return true
  return side[0] === dx && side[1] === dy
}

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
