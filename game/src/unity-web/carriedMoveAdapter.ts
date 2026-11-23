// Unity carried-module InfoCard adapter (plan 39 §6).
//
// Translates the host's live `state.edit` carry preview (`carried`, `plan`,
// `moveReason`) into the pure `HostCarriedMove` shape consumed by `InfoCard.tsx`.
// Keeps preview state strictly separate from the committed station document and
// memoizes by value so `useSyncExternalStore` never triggers redundant renders.

import type { HostCarriedMove } from '../app/stationHostBridge.ts'
import type { Language } from '../sim/i18n.ts'
import { noticeText } from './editNotices.ts'
import type { StationSnapshot } from './stationBridge.ts'

function readAt(plan: Record<string, unknown> | null): { x: number; y: number; z: number } | null {
  if (!plan) return null
  const candidate = plan.candidate as Record<string, unknown> | null | undefined
  if (candidate && typeof candidate === 'object') {
    const x = candidate.x
    const y = candidate.y
    const z = candidate.z
    if (typeof x === 'number' && Number.isFinite(x) &&
        typeof y === 'number' && Number.isFinite(y) &&
        typeof z === 'number' && Number.isFinite(z)) {
      return { x, y, z }
    }
  }
  const cell = plan.cell
  if (Array.isArray(cell) && cell.length === 3 &&
      cell.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return { x: cell[0], y: cell[1], z: cell[2] }
  }
  return null
}

/** Derive the InfoCard carried-move view model from one host snapshot. */
export function readHostCarriedMove(
  snapshot: StationSnapshot,
  ownsStation: boolean,
  locale: Language,
): HostCarriedMove | null {
  if (!ownsStation || snapshot.revision < 0) return null
  const edit = snapshot.state.edit as Record<string, unknown> | null | undefined
  if (!edit || typeof edit !== 'object') return null
  const moduleId = typeof edit.carried === 'string' ? edit.carried : ''
  if (!moduleId) return null

  const rawPlan = edit.plan as Record<string, unknown> | null | undefined
  const plan = rawPlan && typeof rawPlan === 'object' && rawPlan.move === true ? rawPlan : null
  const at = readAt(plan)
  const planReason = plan && typeof plan.reason === 'string' ? plan.reason : ''
  const editReason = typeof edit.moveReason === 'string' ? edit.moveReason : ''
  const rawReason = planReason.length > 0 ? planReason : editReason
  const canDrop = plan !== null && plan.ok === true && plan.candidate != null && rawReason === ''
  const reason = rawReason.length > 0
    ? noticeText({ kind: 'blocked', code: rawReason, tool: 'move' }, locale)
    : ''
  return { moduleId, at, canDrop, reason }
}

function sameCarriedMove(a: HostCarriedMove | null, b: HostCarriedMove | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.moduleId !== b.moduleId || a.canDrop !== b.canDrop || a.reason !== b.reason) return false
  if (a.at === b.at) return true
  if (!a.at || !b.at) return false
  return a.at.x === b.at.x && a.at.y === b.at.y && a.at.z === b.at.z
}

export interface CarriedMoveAdapter {
  getCarriedMove(): HostCarriedMove | null
  subscribeCarriedMove(listener: () => void): () => void
}

export function createCarriedMoveAdapter(deps: {
  getSnapshot: () => StationSnapshot
  subscribe: (listener: () => void) => () => void
  ownsStation: () => boolean
  getLanguage: () => Language
}): CarriedMoveAdapter {
  let cached: HostCarriedMove | null = null
  const compute = (): HostCarriedMove | null => {
    const next = readHostCarriedMove(deps.getSnapshot(), deps.ownsStation(), deps.getLanguage())
    if (!sameCarriedMove(cached, next)) cached = next
    return cached
  }
  return {
    getCarriedMove: compute,
    subscribeCarriedMove(listener) {
      let last = compute()
      return deps.subscribe(() => {
        const next = compute()
        if (!sameCarriedMove(last, next)) {
          last = next
          listener()
        }
      })
    },
  }
}
