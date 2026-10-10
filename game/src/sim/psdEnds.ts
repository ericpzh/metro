// Fixed platform-screen infill joins, GAME-SPEC §5.7.
import type { Module, LineDef } from './types.ts'
import { rotateLocal } from './track.ts'

/** Only the corner carries a length offset; continuations stay on the metre grid. */
export function psdEndOffset(mod: Extract<Module, { type: 'psd-end' }>): [number, number] {
  return [mod.cfg.corner ? mod.cfg.offset?.[0] ?? 0 : 0, mod.cfg.offset?.[1] ?? 0]
}

/** Shorten the corner at its tile boundary; every continuation is exactly 1 m. */
export function psdEndSpan(mod: Extract<Module, { type: 'psd-end' }>, _modules: readonly Module[] = [], _lines: readonly LineDef[] = []): [number, number] {
  const [ox] = psdEndOffset(mod)
  return [Math.max(-0.5, -0.5 - ox), Math.min(0.5, 0.5 - ox)]
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
      // Anchor at the glass corner; psdEndSpan trims the far end to the tile.
      const [cx, cy] = rotateLocal(-(mod.rot ?? 0), dx + intoX * 0.5, dy + intoY * 0.5)
      best = { ...mod, cfg: { ...cfg, offset: [cx, cy + 0.34], corner: screen.id } }
      distance = d
    }
  }
  // A real screen endpoint takes priority over a neighbouring panel's continuation.
  if (best.cfg.corner) return best
  // Carry only the glass plane across tiles, never the corner's length offset.
  for (const other of modules) {
    if (other.type !== 'psd-end' || other.id === mod.id || other.z !== mod.z || other.cfg.psd !== mod.cfg.psd) continue
    const [axisX] = rotateLocal((other.rot ?? 0) - (mod.rot ?? 0), 1, 0)
    if (Math.abs(axisX) < 0.99) continue
    const [along, across] = rotateLocal(-(mod.rot ?? 0), mod.x - other.x, mod.y - other.y)
    if (Math.abs(along) !== 1 || across !== 0) continue
    const [, oy] = psdEndOffset(other)
    const [gx, gy] = rotateLocal(other.rot, 0, oy - 0.34)
    const [dx, dy] = rotateLocal(mod.rot, along, 0)
    const [cx, cy] = rotateLocal(-(mod.rot ?? 0), other.x + gx + dx - mod.x, other.y + gy + dy - mod.y)
    const d = Math.hypot(cx, cy)
    if (d >= distance) continue
    best = { ...mod, cfg: { ...cfg, offset: [0, cy + 0.34] } }
    distance = d
  }
  return best
}

/** Collinear panels share an endpoint, including the shortened corner panel. */
export function isPsdEndJoin(a: Module, b: Module): boolean {
  if (a.type !== 'psd-end' || b.type !== 'psd-end' || a.z !== b.z || a.cfg.psd !== b.cfg.psd) return false
  const [axisX] = rotateLocal((b.rot ?? 0) - (a.rot ?? 0), 1, 0)
  if (Math.abs(axisX) < 0.99) return false
  if (a.x === b.x && a.y === b.y) return false
  const ends = (m: Extract<Module, { type: 'psd-end' }>) => {
    const [ox, oy] = psdEndOffset(m)
    return psdEndSpan(m).map((x) => {
      const [dx, dy] = rotateLocal(m.rot, x + ox, oy - 0.34)
      return [m.x + dx, m.y + dy]
    })
  }
  return ends(a).some(([ax, ay]) => ends(b).some(([bx, by]) => Math.hypot(ax - bx, ay - by) < 1e-6))
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
