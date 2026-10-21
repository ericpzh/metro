// Fixed platform-screen infill joins, GAME-SPEC §5.7.
import type { Module, LineDef } from './types.ts'
import { edgeCells, rotateLocal } from './track.ts'
import { psdFullHeight } from './constants.ts'

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
    if (other.type !== 'psd-end' || other.cfg.variant === 'cover' || other.id === mod.id || other.z !== mod.z || other.cfg.psd !== mod.cfg.psd) continue
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
  if (a.type !== 'psd-end' || b.type !== 'psd-end' || a.cfg.variant === 'cover' || b.cfg.variant === 'cover' || a.z !== b.z || a.cfg.psd !== b.cfg.psd) return false
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

/** Attach one white cover course to a full PSD, end panel, or existing cover. */
export function snapPsdEndCover(
  mod: Extract<Module, { type: 'psd-end' }>,
  modules: readonly Module[],
  lines: readonly LineDef[] = [],
  preferredSupportId?: string,
): Extract<Module, { type: 'psd-end' }> | null {
  type PsdEnd = Extract<Module, { type: 'psd-end' }>
  if (mod.cfg.variant !== 'cover') return null
  const preferred = preferredSupportId ? modules.find((m) => m.id === preferredSupportId) : undefined
  const fromEnd = (end: PsdEnd, support: Module): PsdEnd => {
    const [ox, oy] = psdEndOffset(end)
    const [a, b] = psdEndSpan(end)
    let minX = a + ox, maxX = b + ox
    const minY = Math.max(-0.5, oy - 0.46), maxY = Math.min(0.5, oy - 0.22)
    const parent = modules.find((m) => m.id === end.cfg.corner && m.type === 'platform-edge')
    if (parent?.type === 'platform-edge' && Math.abs(rotateLocal((parent.rot ?? 0) - (end.rot ?? 0), 1, 0)[0]) < 0.01) {
      const wallY = parent.cfg.side === 'right' ? 0.34 : -0.34
      const corners = [-0.5, parent.w - 0.5].flatMap((x) => [wallY - 0.12, wallY + 0.12].map((y) => {
        const [dx, dy] = rotateLocal(parent.rot, x, y)
        return rotateLocal(-(end.rot ?? 0), parent.x + dx - end.x, parent.y + dy - end.y)
      }))
      if (ox > 0) minX = Math.max(minX, Math.max(...corners.map(([x]) => x)))
      else if (ox < 0) maxX = Math.min(maxX, Math.min(...corners.map(([x]) => x)))
    }
    // The cover follows the end door's trimmed local span. End doors render on
    // the left PSD face, even when their parent screen is on its right side.
    return {
      ...mod, x: end.x, y: end.y, z: end.z + 1 + psdFullHeight(end.storeyHeight ?? 5), rot: end.rot,
      cfg: { ...mod.cfg, psd: 'full' as const, support: support.id, width: maxX - minX, depth: maxY - minY,
        offset: [(minX + maxX) / 2, (minY + maxY) / 2 + 0.34] as [number, number], side: 'left' as const },
    }
  }
  // A direct pick is authoritative. In particular, stacked station levels can
  // share x/y, so searching all supports by footprint alone can select below.
  if (preferred?.type === 'psd-end' && preferred.cfg.variant === 'cover') {
    return { ...mod, x: preferred.x, y: preferred.y, z: preferred.z + 1, rot: preferred.rot, cfg: { ...mod.cfg, psd: 'full', support: preferred.id, side: preferred.cfg.side, ...(preferred.cfg.width !== undefined ? { width: preferred.cfg.width } : {}), ...(preferred.cfg.depth !== undefined ? { depth: preferred.cfg.depth } : {}), ...(preferred.cfg.offset ? { offset: preferred.cfg.offset } : {}) } }
  }
  if (preferred?.type === 'psd-end' && preferred.cfg.variant !== 'cover' && preferred.cfg.psd === 'full') {
    return fromEnd(preferred, preferred)
  }
  if (preferred?.type === 'platform-edge' && (preferred.cfg.psd ?? lines.find((l) => l.id === preferred.cfg.line)?.psd ?? 'full') === 'full' &&
    edgeCells(preferred).some(([x, y]) => x === mod.x && y === mod.y)) {
    return { ...mod, z: preferred.z + 1 + psdFullHeight(preferred.storeyHeight ?? 5), rot: preferred.rot, cfg: { ...mod.cfg, psd: 'full', support: preferred.id, side: preferred.cfg.side } }
  }

  if (preferredSupportId) return null

  // Without a module pick, the hit cell's z identifies the intended level.
  // Only stack an existing course when the click itself is on that course.
  const cover = modules.filter((m) => m.type === 'psd-end' && m.cfg.variant === 'cover' && m.id !== mod.id && m.x === mod.x && m.y === mod.y && m.z === mod.z)
    .sort((a, b) => b.z - a.z)[0]
  if (cover?.type === 'psd-end') return { ...mod, x: cover.x, y: cover.y, z: cover.z + 1, rot: cover.rot, cfg: { ...mod.cfg, psd: 'full', support: cover.id, side: cover.cfg.side, ...(cover.cfg.width !== undefined ? { width: cover.cfg.width } : {}), ...(cover.cfg.depth !== undefined ? { depth: cover.cfg.depth } : {}), ...(cover.cfg.offset ? { offset: cover.cfg.offset } : {}) } }

  for (const screen of modules) {
    if (screen.type !== 'platform-edge' || screen.z !== mod.z || (screen.cfg.psd ?? lines.find((l) => l.id === screen.cfg.line)?.psd ?? 'full') !== 'full') continue
    if (!edgeCells(screen).some(([x, y]) => x === mod.x && y === mod.y)) continue
    return { ...mod, z: screen.z + 1 + psdFullHeight(screen.storeyHeight ?? 5), rot: screen.rot, cfg: { ...mod.cfg, psd: 'full', support: screen.id, side: screen.cfg.side } }
  }
  return null
}

/** A saved/previewed cover is supported only when its recorded parent meets its base. */
export function isPsdEndCoverSupport(a: Module, b: Module): boolean {
  const cover = a.type === 'psd-end' && a.cfg.variant === 'cover' ? a
    : b.type === 'psd-end' && b.cfg.variant === 'cover' ? b : undefined
  const support = cover === a ? b : a
  if (!cover || !cover.cfg.support || cover.cfg.support !== support.id) return false
  if (support.type === 'psd-end' && support.cfg.variant === 'cover') {
    return cover.x === support.x && cover.y === support.y && cover.z === support.z + 1 && cover.rot === support.rot
  }
  if (support.type === 'psd-end') {
    const h = support.cfg.psd === 'half' ? 1.5 : psdFullHeight(support.storeyHeight ?? 5)
    const [ox, oy] = psdEndOffset(support)
    const [a, b] = psdEndSpan(support)
    return support.cfg.psd === 'full' && cover.x === support.x && cover.y === support.y && cover.z === support.z + 1 + h && cover.rot === support.rot &&
      (cover.cfg.width ?? 1) > 0 && (cover.cfg.depth ?? 0.24) > 0 &&
      (cover.cfg.offset?.[0] ?? 0) - (cover.cfg.width ?? 1) / 2 >= a + ox - 1e-6 &&
      (cover.cfg.offset?.[0] ?? 0) + (cover.cfg.width ?? 1) / 2 <= b + ox + 1e-6 &&
      (cover.cfg.offset?.[1] ?? 0) - 0.34 - (cover.cfg.depth ?? 0.24) / 2 >= Math.max(-0.5, oy - 0.46) - 1e-6 &&
      (cover.cfg.offset?.[1] ?? 0) - 0.34 + (cover.cfg.depth ?? 0.24) / 2 <= Math.min(0.5, oy - 0.22) + 1e-6
  }
  if (support.type === 'platform-edge') {
    return (support.cfg.psd ?? 'full') === 'full' && cover.z === support.z + 1 + psdFullHeight(support.storeyHeight ?? 5) &&
      edgeCells(support).some(([x, y]) => x === cover.x && y === cover.y) && cover.rot === support.rot
  }
  return false
}
