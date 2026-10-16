import { rotateLocal, trackSideFixtureOffset } from '../../../sim/track.ts'
import type { TrackModule } from '../../../sim/track.ts'

/** Shared by gantry geometry and neighbouring barrier clearance (§5.4). */
export function trackGantryLayout(mod: TrackModule): { xs: number[]; ys: number[] } | null {
  if (mod.cfg.power !== 'catenary' || (!mod.cfg.bridge && (mod.cfg.tunnel || mod.cfg.catenaryStyle !== 'gantry'))) return null
  const d = mod.d ?? 1
  const cy = (d - 1) / 2
  const offset = trackSideFixtureOffset(d)
  const xs: number[] = []
  if (mod.cfg.bridge) {
    for (let x = 0; x < mod.w; x += 8) xs.push(x)
  } else {
    const count = Math.max(1, Math.ceil(mod.w / 8))
    for (let i = 0; i < count; i++) xs.push(count === 1 ? (mod.w - 1) / 2 : (i / (count - 1)) * (mod.w - 1) - 0.5)
  }
  return { xs, ys: [cy - offset, cy + offset] }
}

/** Neighbour uprights in the bridge's local frame, independent of rotation. */
export function neighboringGantryPosts(bridge: TrackModule, tracks: readonly TrackModule[]): { x: number; y: number }[] {
  const posts: { x: number; y: number }[] = []
  for (const mod of tracks) {
    if (mod.id === bridge.id || mod.z !== bridge.z) continue
    const layout = trackGantryLayout(mod)
    if (!layout) continue
    for (const x of layout.xs) for (const y of layout.ys) {
      const [dx, dy] = rotateLocal(mod.rot, x, y)
      const [localX, localY] = rotateLocal(-(bridge.rot ?? 0), mod.x - bridge.x + dx, mod.y - bridge.y + dy)
      if (localX >= -0.56 && localX <= bridge.w - 0.44) posts.push({ x: localX, y: localY })
    }
  }
  return posts
}
