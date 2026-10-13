import { WALK_PROFILES } from './constants.ts'

/** Stable identity keeps physique and free-flow gait through pool compaction
 * and reloads (§7.1, §7.6), without consuming the journey RNG stream. */
function identityHash(id: number): number {
  let hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

export function passengerProportions(id: number, out: number[] = [0, 0, 0]): number[] {
  const hash = identityHash(id)
  const height = ((hash >>> 8) & 255) / 255
  const child = (hash & 255) < 32
  out[0] = child ? 0.58 + height * 0.23 : 0.85 + height * 0.27
  out[1] = (0.9 + ((hash >>> 16) & 255) / 255 * 0.2) * (child ? out[0] * 1.08 : 1)
  out[2] = 0.9 + ((hash >>> 24) & 255) / 255 * 0.15
  return out
}

export function passengerWalkProfile(id: number): number {
  return (identityHash(id) >>> 4) % WALK_PROFILES.length
}

export function passengerWalkSpeed(id: number): number {
  return WALK_PROFILES[passengerWalkProfile(id)].speed * passengerProportions(id)[1]
}
