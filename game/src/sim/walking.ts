import { WALK_PROFILES, PASSENGER_CHILD_CHANCE, PASSENGER_CHILD_SCALE, PASSENGER_CHILD_SIZE_VARIATION, PASSENGER_SIZE_VARIATION } from './constants.ts'

/** Stable identity keeps physique and free-flow gait through pool compaction
 * and reloads (§7.1, §7.6), without consuming the journey RNG stream. */
function identityHash(id: number, salt = 0x9e3779b9): number {
  let hash = Math.imul(id ^ salt, 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

export function passengerIsChild(id: number): boolean {
  return identityHash(id, 0x7f4a7c15) / 0x100000000 < PASSENGER_CHILD_CHANCE
}

/** Height, fore/aft depth (and stride), width, ink tone. Each axis has its own
 * identity hash, so a tall passenger need not also be wide or deep. */
export function passengerProportions(id: number, out: number[] = [0, 0, 0, 0]): number[] {
  const child = passengerIsChild(id), range = PASSENGER_SIZE_VARIATION
  const horizontal = child ? PASSENGER_CHILD_SIZE_VARIATION : range
  out[0] = (range.height[0] + identityHash(id, 0x243f6a88) / 0x100000000 * (range.height[1] - range.height[0])) * (child ? PASSENGER_CHILD_SCALE.height : 1)
  out[1] = (horizontal.depth[0] + identityHash(id, 0x85a308d3) / 0x100000000 * (horizontal.depth[1] - horizontal.depth[0])) * (child ? PASSENGER_CHILD_SCALE.depth : 1)
  out[2] = (horizontal.width[0] + identityHash(id, 0x13198a2e) / 0x100000000 * (horizontal.width[1] - horizontal.width[0])) * (child ? PASSENGER_CHILD_SCALE.width : 1)
  out[3] = 0.9 + identityHash(id, 0x03707344) / 0x100000000 * 0.15
  return out
}

export function passengerWalkProfile(id: number): number {
  return (identityHash(id) >>> 4) % WALK_PROFILES.length
}

export function passengerWalkSpeed(id: number): number {
  return WALK_PROFILES[passengerWalkProfile(id)].speed * passengerProportions(id)[1]
}
