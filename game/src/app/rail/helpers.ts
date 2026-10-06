// Types and pure helpers shared by the rail shell and its folders (plan.md R6).
//
// `FolderKey` / `SubMenuKey` / `subMenuForModule` / `findSelectedTrack` are each
// read by two units (the shell's open-state effects and the folders that render
// the matching rows), so they live here instead of being duplicated — and here
// rather than in the shell, so folders never import the shell that imports them
// (no cycles, plan.md C4).

import { familyFor, type ModuleFamilyKey } from '../store.ts'
import type { AppState } from '../store.ts'
import type { Module } from '../../sim/types.ts'

/** One rail folder per key; `RAIL_FOLDERS` is the order they are stacked in. */
export type FolderKey = 'tools' | 'equipment' | 'rail' | 'rooms' | 'decor' | 'surfaces' | 'zones' | 'view'

/**
 * The rail's folders, top to bottom, each with the Shift+letter that opens and
 * closes it — **Shift+Q** the first folder, then W, E, R, T, Y, U, I one letter a
 * row down the stack. The ladder is data because two units read it: the shell
 * renders the folders in this order and prints each key on its header, and the
 * app's one keydown listener turns a Shift+letter into the folder to fold
 * (`app/windows/AppShell.tsx` → the `metro:folder` event the rail listens for).
 * It lives here rather than in either of them so the order, the key on the header
 * and the key that fires can never drift apart.
 *
 * A folder added at the bottom takes the next letter (**O**); one inserted in the
 * middle moves every key below it, so keep the ladder in step with the render.
 */
export const RAIL_FOLDERS: ReadonlyArray<{ key: FolderKey; title: string; shift: string }> = [
  { key: 'tools', title: '工具', shift: 'Q' },
  { key: 'rail', title: '轨道', shift: 'W' },
  { key: 'equipment', title: '设备', shift: 'E' },
  { key: 'decor', title: '装饰', shift: 'R' },
  { key: 'rooms', title: '房间', shift: 'T' },
  { key: 'zones', title: '分区', shift: 'Y' },
  { key: 'surfaces', title: '材质', shift: 'U' },
  { key: 'view', title: '视图', shift: 'I' },
]

/**
 * The folder a Shift+letter folds, or null when no folder stands on that letter.
 * Case-blind, because the caller hands over `KeyboardEvent.key.toLowerCase()`.
 */
export function folderForShiftKey(letter: string): FolderKey | null {
  const hit = RAIL_FOLDERS.find((f) => f.shift.toLowerCase() === letter.toLowerCase())
  return hit ? hit.key : null
}

/**
 * The nested variant sub-menus: the module families (`app/store/catalog.ts`) plus the
 * 材质 folder's 搪瓷板 colour list, which is a paint brush's swatches rather than a family
 * of pieces. At most one is expanded at a time.
 */
export type SubMenuKey = ModuleFamilyKey | 'enamel'

/**
 * Which nested variant sub-menu owns a module, or null when it owns none. Derived from
 * the one family table, so a family added there is wired into the rail's single
 * open-slot state automatically — a variant can never fold its own list away.
 */
export function subMenuForModule(moduleType: string): SubMenuKey | null {
  return familyFor(moduleType)?.key ?? null
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
