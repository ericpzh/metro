// Plan 32 §F: Apply a committed local station delta directly to the immutable
// `StationState` in O(|delta|) without re-parsing or re-scanning untouched cells/modules.

import { normalizeCityStyle } from '../sim/cityStyles.ts'
import { normalizeLevelBase, STOREY_HEIGHT } from '../sim/constants.ts'
import type { Cell, Module, StationData } from '../sim/types.ts'
import { cellKey, cloneCell } from '../build/model/Cells.ts'
import { assignAdPosters, ensureSignLayouts } from '../build/model/Equipment.ts'
import type { StationState } from '../build/model/State.ts'
import type { StationCommitDelta } from './stationBridge.ts'

const cellIndexCache = new WeakMap<readonly Cell[], Map<string, number>>()

function getOrBuildCellIndex(cells: readonly Cell[]): Map<string, number> {
  const cached = cellIndexCache.get(cells)
  if (cached) return cached
  const built = new Map<string, number>()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    built.set(cellKey(c.x, c.y, c.z), i)
  }
  cellIndexCache.set(cells, built)
  return built
}

/** Seed the coordinate-to-index cache right after a full `parse()` open/resync. */
export function seedStationCellIndex(cells: readonly Cell[]): void {
  getOrBuildCellIndex(cells)
}

function normalizeDeltaModules(rawModules: Record<string, unknown>[], base: StationState): Module[] {
  if (rawModules.length === 0) return []
  const cloned = rawModules.map(raw => (typeof structuredClone === 'function' ? structuredClone(raw) : JSON.parse(JSON.stringify(raw))) as unknown as Module)
  const meta: Pick<StationData, 'lines' | 'cityStyle'> = {
    lines: base.lines,
    cityStyle: base.cityStyle,
  }
  return ensureSignLayouts(assignAdPosters(cloned), meta as StationData).map(m =>
    m.storeyHeight === undefined ? { ...m } : { ...m, storeyHeight: STOREY_HEIGHT },
  )
}

/**
 * Apply one sequential `StationCommitDelta` to `previous`, preserving exact `===`
 * reference identity for untouched `cells`, `modules`, `lines`, and schedule objects.
 */
export function applyStationDelta(previous: StationState, delta: StationCommitDelta): StationState {
  const cityStyle = typeof delta.city === 'string' && delta.city.length > 0
    ? normalizeCityStyle(delta.city)
    : previous.cityStyle
  const name = typeof delta.name === 'string' ? delta.name : previous.name
  const nameEn = typeof delta.nameEn === 'string' ? delta.nameEn.trim() : previous.nameEn
  const levelBase = typeof delta.levelBase === 'number' && Number.isFinite(delta.levelBase)
    ? normalizeLevelBase(delta.levelBase, STOREY_HEIGHT)
    : previous.levelBase

  let nextCells = previous.cells
  if (delta.removedCells.length > 0 || delta.changedCells.length > 0) {
    const prevIndex = getOrBuildCellIndex(previous.cells)
    cellIndexCache.delete(previous.cells)
    nextCells = previous.cells.slice()
    const nextIndex = prevIndex

    for (let i = 0; i < delta.removedCells.length; i++) {
      const coords = delta.removedCells[i]
      if (!Array.isArray(coords) || coords.length < 3) continue
      const rmKey = cellKey(coords[0], coords[1], coords[2])
      const at = nextIndex.get(rmKey)
      if (at === undefined) continue
      const lastIdx = nextCells.length - 1
      if (at !== lastIdx) {
        const moved = nextCells[lastIdx]
        nextCells[at] = moved
        nextIndex.set(cellKey(moved.x, moved.y, moved.z), at)
      }
      nextCells.pop()
      nextIndex.delete(rmKey)
    }

    for (let i = 0; i < delta.changedCells.length; i++) {
      const raw = delta.changedCells[i] as unknown as Cell
      if (!raw || typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.z !== 'number') continue
      const cell = cloneCell(raw)
      const k = cellKey(cell.x, cell.y, cell.z)
      const existing = nextIndex.get(k)
      if (existing !== undefined) {
        nextCells[existing] = cell
      } else {
        nextIndex.set(k, nextCells.length)
        nextCells.push(cell)
      }
    }

    cellIndexCache.set(nextCells, nextIndex)
  }

  let nextModules = previous.modules
  if (delta.removedModules.length > 0 || delta.changedModules.length > 0) {
    const baseForNorm: StationState = { ...previous, cityStyle, name, nameEn, levelBase }
    const normalizedChanged = normalizeDeltaModules(delta.changedModules, baseForNorm)
    const removedSet = delta.removedModules.length > 0 ? new Set(delta.removedModules) : null
    const changedById = new Map<string, Module>()
    for (let i = 0; i < normalizedChanged.length; i++) {
      const m = normalizedChanged[i]
      if (typeof m.id === 'string' && m.id.length > 0) changedById.set(m.id, m)
    }

    const updated: Module[] = []
    const placedIds = new Set<string>()
    for (let i = 0; i < previous.modules.length; i++) {
      const prevMod = previous.modules[i]
      if (removedSet?.has(prevMod.id)) continue
      const replacement = changedById.get(prevMod.id)
      if (replacement !== undefined) {
        updated.push(replacement)
        placedIds.add(prevMod.id)
      } else {
        updated.push(prevMod)
      }
    }
    for (let i = 0; i < normalizedChanged.length; i++) {
      const m = normalizedChanged[i]
      if (typeof m.id === 'string' && m.id.length > 0 && !placedIds.has(m.id) && !removedSet?.has(m.id)) {
        updated.push(m)
        placedIds.add(m.id)
      }
    }
    nextModules = updated
  }

  if (
    nextCells === previous.cells &&
    nextModules === previous.modules &&
    cityStyle === previous.cityStyle &&
    name === previous.name &&
    nameEn === previous.nameEn &&
    levelBase === previous.levelBase
  ) {
    return previous
  }

  return {
    ...previous,
    cityStyle,
    name,
    nameEn,
    levelBase,
    cells: nextCells,
    modules: nextModules,
  }
}
