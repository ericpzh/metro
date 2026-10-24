/** Passenger gestures share the existing six-float stream's former cosmetic phase.
 * 4 kind bits + 8 heading bits + 12 timeline bits fit exactly in Float32. */
export const ACTIVITY_NAMES = ['walk', 'sit', 'shop', 'ticket', 'vending', 'qr', 'card', 'escalator', 'lift', 'toilet', 'wash', 'door', 'wait', 'queue', 'escalator-left'] as const
export type ActivityName = typeof ACTIVITY_NAMES[number]
export const ACTIVITY_DURATION = [1, 10, 9, 10, 10, 8, 8, 10, 9, 10, 10, 10, 12, 12, 10] as const
export const ACTIVITY_SAMPLES = 24
export function activityChoice(id: number, salt: number): number {
  let h = Math.imul(id ^ salt, 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Approved rail reach at 30 degrees: wrist ahead of the shoulder, inboard of
 * the actual belt. Wide runs have a 0.35 m passenger column on each side. */
export function activityRailTarget(variant: number, height = 1): [number, number, number] {
  const down = variant >= 2
  let forward = .12 + .22 * Math.max(0,Math.min(1,(height-.8)/.1))
  if (down && height>1) forward*=Math.max(.4,1-(height-1)*3)
  return [variant % 2 ? .43 : .28, 1.055 / Math.cos(Math.PI / 6) + (down ? -1 : 1) * forward * Math.tan(Math.PI / 6), forward]
}
export function railTimeline(elapsed: number, total: number, variant: number): number {
  const clamp=(v:number)=>Math.max(0,Math.min(1,v)),remaining=total-elapsed
  const frame=elapsed<1.5 ? 2*clamp(elapsed/1.5)
    : remaining<1.5 ? 5-2*clamp(remaining/1.5)
    : 2+clamp((elapsed-1.5)/Math.max(1,total-3))
  return (variant*6+frame)/(ACTIVITY_SAMPLES-1)*10
}
/** Release inside the selected hand/lane's clip, never through another one. */
export function activityEndTime(kind: number, time: number): number {
  if (kind===5 || kind===6) return time<4?4:8
  if (kind===7 || kind===14) {
    const variant=Math.min(3,Math.floor(time/10*(ACTIVITY_SAMPLES-1)/6))
    return (variant*6+5)/(ACTIVITY_SAMPLES-1)*10
  }
  return ACTIVITY_DURATION[kind]
}
export function packActivity(kind: number, time: number, yaw: number): number {
  if (!kind) return 0
  const heading = ((Math.round(yaw / (Math.PI * 2) * 256) % 256) + 256) % 256
  return kind * 1048576 + heading * 4096 + Math.round(Math.max(0, Math.min(1, time / ACTIVITY_DURATION[kind])) * 4095)
}
export function unpackActivity(value: number, out: number[] = [0, 0, 0]): number[] {
  out[0] = Math.floor(value / 1048576)
  out[1] = (value % 4096) / 4095 * ACTIVITY_DURATION[out[0]]
  out[2] = (Math.floor(value / 4096) % 256) / 256 * Math.PI * 2
  return out
}
/** Preserve the settle/stand transitions around a variable length dwell. */
export function dwellTimeline(elapsed: number, total: number, kind: number): number {
  const duration = ACTIVITY_DURATION[kind]
  if (elapsed < 2.5) return elapsed
  if (total - elapsed < 2) return duration - Math.max(0, total - elapsed)
  return 3 + (elapsed - 2.5) % Math.max(1, duration - 5.5)
}
