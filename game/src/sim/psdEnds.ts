// Fixed platform-screen infill joins, GAME-SPEC §5.7.
import type { Module, LineDef } from './types.ts'
import { rotateLocal } from './track.ts'

/** Panel ends in its local frame. Extend to a perpendicular screen's glass plane. */
export function psdEndSpan(mod: Extract<Module, { type: 'psd-end' }>, modules: readonly Module[], lines: readonly LineDef[] = []): [number, number] {
  if (mod.cfg.offset) return [-0.5, 0.5]
  let a = -0.5
  let b = 0.5
  for (const other of modules) {
    if (other.id === mod.id || other.z !== mod.z || (other.type !== 'platform-edge' && other.type !== 'psd-end')) continue
    const height = other.type === 'psd-end' ? other.cfg.psd : other.cfg.psd ?? lines.find((l) => l.id === other.cfg.line)?.psd ?? 'full'
    if (height !== mod.cfg.psd) continue
    const rot = (other.rot ?? 0) - (mod.rot ?? 0)
    const [dx, dy] = rotateLocal(rot, 1, 0)
    if (Math.abs(dx) > 0.01) continue
    const [ox, oy] = rotateLocal(-(mod.rot ?? 0), other.x - mod.x, other.y - mod.y)
    const wall = other.type === 'platform-edge' && other.cfg.side === 'right' ? 0.34 : -0.34
    const [wx, wy] = rotateLocal(rot, 0, wall)
    const cross = ox + wx
    const along = (-0.34 - oy - wy) / dy
    const end = other.type === 'platform-edge' ? other.w - 0.5 : 0.5
    if (along < -0.5 - 1e-6 || along > end + 1e-6) continue
    // Only join the adjacent tile; never stretch a panel across empty ground.
    if (cross >= 0.5 - 1e-6 && cross <= 0.84 + 1e-6) b = Math.max(b, cross)
    if (cross <= -0.5 + 1e-6 && cross >= -0.84 - 1e-6) a = Math.min(a, cross)
  }
  return [a, b]
}

/** Snap a perpendicular return to the nearest run endpoint in the hovered corner tile. */
export function snapPsdEnd(mod: Extract<Module, { type: 'psd-end' }>, modules: readonly Module[], lines: readonly LineDef[] = []): Extract<Module, { type: 'psd-end' }> {
  const { offset: _offset, corner: _corner, ...cfg } = mod.cfg
  let best = { ...mod, cfg } as Extract<Module, { type: 'psd-end' }>
  let distance = 0.8
  for (const screen of modules) {
    if (screen.type !== 'platform-edge' || screen.z !== mod.z) continue
    const height = screen.cfg.psd ?? lines.find((l) => l.id === screen.cfg.line)?.psd ?? 'full'
    if (height !== mod.cfg.psd) continue
    const relative = (screen.rot ?? 0) - (mod.rot ?? 0)
    const [axisX] = rotateLocal(relative, 1, 0)
    if (Math.abs(axisX) > 0.01) continue
    const toward = screen.cfg.side === 'right' ? 1 : -1
    const [intoX, intoY] = rotateLocal(screen.rot, 0, -toward)
    for (const end of [-0.5, screen.w - 0.5]) {
      const [ex, ey] = rotateLocal(screen.rot, end, toward * 0.34)
      const dx = screen.x + ex - mod.x
      const dy = screen.y + ey - mod.y
      const d = Math.hypot(dx, dy)
      if (d >= distance) continue
      // The one-metre panel extends from the glass corner toward the platform.
      const [cx, cy] = rotateLocal(-(mod.rot ?? 0), dx + intoX * 0.5, dy + intoY * 0.5)
      best = { ...mod, cfg: { ...cfg, offset: [cx, cy + 0.34], corner: screen.id } }
      distance = d
    }
  }
  // A real screen endpoint takes priority over a neighbouring panel's continuation.
  if (best.cfg.corner) return best
  // A corner return is shifted inside its tile. Carry that exact glass plane
  // along adjacent tiles rather than reverting the next panel to the default pose.
  for (const other of modules) {
    if (other.type !== 'psd-end' || other.id === mod.id || other.z !== mod.z || other.cfg.psd !== mod.cfg.psd) continue
    const [axisX] = rotateLocal((other.rot ?? 0) - (mod.rot ?? 0), 1, 0)
    if (Math.abs(axisX) < 0.99) continue
    const [along, across] = rotateLocal(-(mod.rot ?? 0), mod.x - other.x, mod.y - other.y)
    if (Math.abs(along) !== 1 || across !== 0) continue
    const [ox, oy] = other.cfg.offset ?? [0, 0]
    const [gx, gy] = rotateLocal(other.rot, ox, oy - 0.34)
    const [dx, dy] = rotateLocal(mod.rot, along, 0)
    const [cx, cy] = rotateLocal(-(mod.rot ?? 0), other.x + gx + dx - mod.x, other.y + gy + dy - mod.y)
    const d = Math.hypot(cx, cy)
    if (d >= distance) continue
    best = { ...mod, cfg: { ...cfg, offset: [cx, cy + 0.34] } }
    distance = d
  }
  return best
}

/** Collinear one-metre panels meet at their ends, even after a sub-cell corner snap. */
export function isPsdEndJoin(a: Module, b: Module): boolean {
  if (a.type !== 'psd-end' || b.type !== 'psd-end' || a.z !== b.z || a.cfg.psd !== b.cfg.psd) return false
  const [axisX] = rotateLocal((b.rot ?? 0) - (a.rot ?? 0), 1, 0)
  if (Math.abs(axisX) < 0.99) return false
  const [ax, ay] = rotateLocal(a.rot, a.cfg.offset?.[0] ?? 0, (a.cfg.offset?.[1] ?? 0) - 0.34)
  const [bx, by] = rotateLocal(b.rot, b.cfg.offset?.[0] ?? 0, (b.cfg.offset?.[1] ?? 0) - 0.34)
  const [along, across] = rotateLocal(-(a.rot ?? 0), b.x + bx - a.x - ax, b.y + by - a.y - ay)
  return Math.abs(Math.abs(along) - 1) < 1e-6 && Math.abs(across) < 1e-6
}

/** Only a geometrically valid snapped joint can share the screen's reservation. */
export function isPsdCornerPair(a: Module, b: Module): boolean {
  const panel = a.type === 'psd-end' ? a : b.type === 'psd-end' ? b : undefined
  const screen = a.type === 'platform-edge' ? a : b.type === 'platform-edge' ? b : undefined
  if (!panel || !screen || panel.cfg.corner !== screen.id || !panel.cfg.offset) return false
  const expected = snapPsdEnd(panel, [{ ...screen, cfg: { ...screen.cfg, psd: screen.cfg.psd ?? panel.cfg.psd } }])
  return expected.cfg.corner === screen.id && expected.cfg.offset !== undefined &&
    expected.cfg.offset.every((v, i) => Math.abs(v - panel.cfg.offset![i]) < 1e-6)
}
