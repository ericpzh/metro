// Types and pure helpers shared by the rail shell and its folders (plan.md R6).
//
// `FolderKey` / `SubMenuKey` / `subMenuForModule` / `findSelectedTrack` are each
// read by two units (the shell's open-state effects and the folders that render
// the matching rows), so they live here instead of being duplicated — and here
// rather than in the shell, so folders never import the shell that imports them
// (no cycles, plan.md C4).

import { isBenchType, isBillboardType, isExitType, isStairType } from '../store.ts'
import type { AppState } from '../store.ts'
import type { Module } from '../../sim/types.ts'

/** One rail folder per key: 工具 / 设备 / 轨道 / 房间 / 装饰 / 材质 / 分区 / 视图. */
export type FolderKey = 'tools' | 'equipment' | 'rail' | 'rooms' | 'decor' | 'surfaces' | 'zones' | 'view'

/** The nested variant sub-menus, at most one of which may be expanded. */
export type SubMenuKey = 'stair' | 'exit' | 'bench' | 'billboard' | 'enamel'

/** Which nested variant sub-menu owns a module, or null if it owns none. */
export function subMenuForModule(moduleType: string): SubMenuKey | null {
  if (isStairType(moduleType)) return 'stair'
  if (isExitType(moduleType)) return 'exit'
  if (isBenchType(moduleType)) return 'bench'
  if (isBillboardType(moduleType)) return 'billboard'
  return null
}

/**
 * The placed platform/tunnel run the 轨道 folder edits, if the selection is one
 * (§7.2 rail editing). Shared by the shell — selecting a rail reveals the 轨道
 * folder — and the 轨道 folder itself, which edits the run or, when null, the
 * defaults the next placement will use.
 */
export function findSelectedTrack(
  selected: AppState['selected'],
  stationModules: AppState['station']['modules'],
): Extract<Module, { type: 'track' }> | undefined {
  if (selected?.kind !== 'module') return undefined
  return stationModules.find((m) => m.id === selected.key && m.type === 'track') as Extract<Module, { type: 'track' }> | undefined
}
