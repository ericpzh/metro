import type { FinishId } from '../sim/types.ts'

export type ParsedHostPick =
  | { kind: 'module'; key: string; moduleId: string; armable: boolean }
  | { kind: 'face'; key: string; cell: [number, number, number]; face: string; finish: FinishId }
  | { kind: 'none'; key: '' }

const NONE_PICK: ParsedHostPick = { kind: 'none', key: '' }

function parseSeq(pick: Record<string, unknown>): number | null {
  return typeof pick.seq === 'number' && Number.isFinite(pick.seq) && pick.seq > 0 ? pick.seq : null
}

function parseCell(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const [x, y, z] = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

/**
 * Parse Unity's `state.edit.pick` payload into a typed adoption target with a
 * deduplication key. Uses the host's monotonic `seq` when present so repeated picks
 * of the same module or block face are adopted every time rather than suppressed.
 */
export function parseHostPick(pick: Record<string, unknown> | null | undefined): ParsedHostPick {
  if (!pick) return NONE_PICK
  const seq = parseSeq(pick)
  const moduleId = typeof pick.moduleId === 'string' ? pick.moduleId : ''
  if (moduleId) {
    const armable = typeof pick.armable === 'boolean' ? pick.armable : true
    return {
      kind: 'module',
      key: seq !== null ? `module|${seq}|${moduleId}` : `module|${moduleId}`,
      moduleId,
      armable,
    }
  }
  const finish = typeof pick.finish === 'string' ? pick.finish : ''
  const cell = parseCell(pick.cell)
  if (finish && cell) {
    const face = typeof pick.face === 'string' ? pick.face : ''
    return {
      kind: 'face',
      key: seq !== null ? `face|${seq}|${finish}|${cell.join(',')}|${face}` : `face|${finish}|${cell.join(',')}|${face}`,
      cell,
      face,
      finish: finish as FinishId,
    }
  }
  return NONE_PICK
}
