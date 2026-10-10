// Types and pure helpers shared by the rail shell and its folders (plan.md R6).
//
// `FolderKey` (and the two tables it spans — the rail's Shift ladder and the 信息栏's Alt
// one) / `SubMenuKey` / `subMenuForModule` / `findSelectedTrack` are each read by more
// than one unit (the two column shells' open-state effects, the folders that render the
// matching rows, and the app's keydown listener), so they live here instead of being
// duplicated — and here rather than in a shell, so folders never import the shell that
// imports them (no cycles, plan.md C4).

import {
  actionsAnchorFor,
  cutAnchor,
  cutModeOf,
  familyFor,
  hasModuleActions,
  type CutMode,
  type ModuleFamilyKey,
} from '../store.ts'
import type { AppState, Tool, ZoneBrush } from '../store.ts'
import { finishBaseId } from '../../sim/finishes.ts'
import { ZONE_LIST } from '../../sim/zones.ts'
import type { Module, TriangleKind } from '../../sim/types.ts'

/** One build-rail folder per key; `RAIL_FOLDERS` is the order they are stacked in. */
export type RailFolderKey = 'tools' | 'rail' | 'equipment' | 'decor' | 'surfaces' | 'rooms' | 'zones'

/** One 信息栏 (RHS) folder per key; `INSPECTOR_FOLDERS` is the inspector's own stack. */
export type InspectorFolderKey = 'info' | 'view' | 'exits' | 'lines'

/** A folder a shortcut folds, in whichever column it lives. */
export type FolderKey = RailFolderKey | InspectorFolderKey

/**
 * The **build rail's** folders, top to bottom, each with the Shift+letter that opens
 * and closes it — **Shift+Q** the first folder, then W, E, R, T, Y, U one letter a row
 * down the stack. The ladder is data because two units read it: the shell renders the
 * folders in this order and prints each key on its header, and the app's one keydown
 * listener turns a Shift+letter into the folder to fold
 * (`app/windows/AppShell.tsx` → the `metro:folder` event the rail listens for).
 * It lives here rather than in either of them so the order, the key on the header
 * and the key that fires can never drift apart.
 *
 * A folder added at the bottom takes the next letter; one inserted in the middle moves
 * every key below it, so keep the ladder in step with the render.
 */
export const RAIL_FOLDERS: ReadonlyArray<{ key: RailFolderKey; title: string; shift: string }> = [
  { key: 'tools', title: '工具', shift: 'Q' },
  { key: 'rail', title: '结构', shift: 'W' },
  { key: 'equipment', title: '设备', shift: 'E' },
  { key: 'decor', title: '装饰', shift: 'R' },
  { key: 'surfaces', title: '材质', shift: 'T' },
  { key: 'rooms', title: '房间', shift: 'Y' },
  { key: 'zones', title: '分区', shift: 'U' },
]

/**
 * The **信息栏's** (RHS) folders, top to bottom, each with the **Alt+letter** that folds
 * it — Alt+Q down the stack, one letter a row. The inspector is its own column with its
 * own modifier, so the two ladders never compete for a key: **Shift** belongs to the
 * build rail (Q W E R T Y U, the tools) and **Alt** to the read-outs, and every folder
 * in this column is labeled here rather than in the JSX, so its header, its badge and
 * the key that fires come from one row (`windows/inspector/Inspector.tsx` renders the
 * table in this order; `folderForAltKey` is how the app's listener names one).
 *
 * 视图 sits between 信息 and 出入口: it moved out of the build rail because its tiles
 * (显示其他层 / 剖切 / 隐藏UI / 隐藏天花板 / 隐藏墙壁 / 隐藏地面 / 分区图 / 热力图) are controls over
 * how the station is *drawn* rather than pieces of it. A fifth folder would take
 * **Alt+T**, the next letter on this ladder.
 */
export const INSPECTOR_FOLDERS: ReadonlyArray<{ key: InspectorFolderKey; title: string; alt: string }> = [
  { key: 'info', title: '信息', alt: 'Q' },
  { key: 'view', title: '视图', alt: 'W' },
  { key: 'exits', title: '出入口', alt: 'E' },
  { key: 'lines', title: '线路', alt: 'R' },
]

/**
 * The build-rail folder a **Shift+letter** folds, or null when no folder stands on that
 * letter. Case-blind, because the caller hands over `KeyboardEvent.key.toLowerCase()`.
 */
export function folderForShiftKey(letter: string): RailFolderKey | null {
  const hit = RAIL_FOLDERS.find((f) => f.shift.toLowerCase() === letter.toLowerCase())
  return hit ? hit.key : null
}

/**
 * The 信息栏 folder an **Alt+letter** folds, or null — the inspector's half of the same
 * split (`rail/LeftRail.tsx` owns the Shift ladder, `windows/inspector/Inspector.tsx`
 * this one). Case-blind for the same reason.
 */
export function folderForAltKey(letter: string): InspectorFolderKey | null {
  const hit = INSPECTOR_FOLDERS.find((f) => f.alt.toLowerCase() === letter.toLowerCase())
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
 * The placed platform/tunnel run the 结构 folder edits, if the selection is one
 * (§7.2 rail editing). Shared by the shell — selecting a rail reveals the 结构
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

/* ------------------------------------------------------ the 工具 folder's shape */

/**
 * Whether the **生成墙壁** tile is in the 工具 folder at all.
 *
 * It is not: a 半墙 or a 三角 *is* the wall a patch would otherwise grow, so while
 * one of the cut modes owns the tool the ring has nothing to say — the tile was
 * drawn greyed out with a tooltip explaining why, which is a control the player
 * cannot use taking a place among the ones they can. It is not shown, rather than
 * shown disabled, and it comes back with the plain 方块 tile. Its key, **Tab**, is
 * refused under the same condition (`setAutoWalls`), so the tile's absence and the
 * key's silence are one rule.
 */
export function showsAutoWalls(tool: Tool, cut: CutMode | null): boolean {
  return tool === 'block' && cut === null
}

/**
 * The 工具 folder's four main tiles: 选择 / 吸取 / 移动 / 删除.
 * Structure placement and its contextual controls live in 结构.
 * 撤销 / 重做 live in the top bar, beside the file buttons.
 */
export function toolsFolderTiles(): number {
  return 4
}

/* ------------------------------------------------------ what the rail is armed with */

/**
 * The state the rail's two tile questions are answered from. Every field is a plain
 * store field, so the store can be handed straight in (and the two selectors below
 * are `useStore(armedRailTile)` / `useStore(armedActionsAnchor)`).
 */
export interface ArmedState {
  tool: Tool
  moduleType: string
  zoneBrush: ZoneBrush
  paintFinish: string
  halfWall: boolean
  triangles: boolean
  triKind: TriangleKind
}

/**
 * The cut piece the next 方块 click will lay, or null for a plain block — the rail's
 * selector for it (`useStore(armedCut)`), over the one function that reads the store's
 * two fields as the single thing they mean (`cutModeOf`).
 *
 * Every unit that cares asks this way: the folder that draws the cut tiles, the grid that
 * folds their 旋转 out, and the shell that counts the folder's tiles. None of them reads
 * `halfWall` / `triangles` / `triKind` for itself.
 */
export function armedCut(s: { halfWall: boolean; triangles: boolean; triKind: TriangleKind }): CutMode | null {
  return cutModeOf(s.halfWall, s.triangles, s.triKind)
}

/**
 * What the rail is armed with, as the two tiles the rail cares about — **one
 * derivation, read by every folder**: no folder asks "is this a cut mode?" or "is
 * this a family?" for itself, so a piece and a cut travel the same path.
 */
export interface ArmedTiles {
  /**
   * The tile that **is** the armed thing: the placement's own variant, the cut piece
   * the next click will lay, a rail / room / finish tile. The shell scrolls it into
   * view, which is what makes a 吸取 land somewhere the player can see.
   */
  tile: string | null
  /**
   * The tile the armed thing's **action row** folds out under — a family's parent tile
   * when the thing is one of its variants, and the piece's or the cut's own tile
   * otherwise (`actionsAnchorFor` / `cutAnchor`). Null when it owns no action tiles,
   * which is what keeps a row from folding out under a tile that has none.
   */
  actions: string | null
}

/**
 * Answer both questions for whatever is armed.
 *
 * The **pieces** and the **cut modes** are deliberately the same shape here: a 座椅
 * with a 旋转 and a 半墙 with a 旋转 anchor their rows the same way and fold out the
 * same `ActionRow`, so adding one is a row in a table (`MODULE_OPTIONS` /
 * `CUT_MODES`) rather than a branch in a folder.
 */
export function armedTiles(s: ArmedState): ArmedTiles {
  switch (s.tool) {
    case 'module':
      return {
        tile: s.moduleType,
        actions: hasModuleActions(s.moduleType) ? actionsAnchorFor(s.moduleType) : null,
      }
    case 'block': {
      // A cut piece owns its own action row; the plain block reveals its main
      // structure tile, while its generated-wall setting folds out beneath it.
      const cut = armedCut(s)
      const anchor = cut === null ? 'block' : cutAnchor(cut)
      return { tile: anchor, actions: cut === null ? null : anchor }
    }
    case 'wall':
      return { tile: 'wall', actions: null }
    case 'move':
      return { tile: 'move', actions: null }
    case 'rail':
      return { tile: PLATFORM_TILE, actions: null }
    case 'tunnel':
      return { tile: TUNNEL_TILE, actions: null }
    case 'zone':
      // A fare zone and a facility room are one brush slot in two folders; either
      // way the tile wears the brush's own id.
      return { tile: s.zoneBrush, actions: null }
    case 'paint':
      // 搪瓷板's brush carries its colour in the id (`wall.enamel#rrggbb`), and the
      // tile is the finish it is a shade of.
      return { tile: finishBaseId(s.paintFinish), actions: null }
    default:
      return { tile: null, actions: null }
  }
}

/** The armed thing's own tile — the rail shell's selector. */
export function armedRailTile(s: ArmedState): string | null {
  return armedTiles(s).tile
}

/** The anchor the armed thing's action row folds out under — every grid's selector. */
export function armedActionsAnchor(s: ArmedState): string | null {
  return armedTiles(s).actions
}

/* ----------------------------------------------------- what the rail keeps in view */

/** The 结构 folder's platform and tunnel tiles, as `data-tile` ids. */
export const PLATFORM_TILE = '__platform'
export const TUNNEL_TILE = '__tunnel'

/**
 * How many tiles the 分区 folder can put on screen: one per zone in `ZONE_LIST`,
 * **无分区** included — that tile is the brush that takes a label off
 * (`isEraseBrush`) — plus the three walled-room brushes (商店 / 厕所 / 办公室)
 * the folder also arms, so the count is the zone list plus those three.
 */
export function zoneFolderTiles(): number {
  return ZONE_LIST.length + 3
}

/** A rectangle, in the two numbers a "is it in view" test needs. */
export interface ViewRect {
  top: number
  bottom: number
}

/** The margin a revealed tile keeps from the rail's edge, in pixels. */
export const REVEAL_PAD = 8

/**
 * How long the rail's folds take to settle, in milliseconds. A folder opens over
 * 280 ms and a variant sub-menu over 260 ms (`styles.css` `.folderBody` /
 * `.subMenu`), so a reveal waits this long before its second, authoritative pass —
 * the first one measured a tile that was still moving.
 */
export const REVEAL_SETTLE_MS = 360

/**
 * How far a scroll container has to move to bring `rect` into view, in pixels:
 * negative when the tile is above the box, positive when it is below it, and `0`
 * when it already fits — so revealing a tile that is on screen moves nothing.
 *
 * A tile too tall for the box is aligned by its **top**, because the top is where
 * its label is: scrolling to its bottom edge instead would fill the rail with the
 * tile's lower half and hide the one thing that identifies it.
 */
export function revealScrollDelta(box: ViewRect, rect: ViewRect, pad = REVEAL_PAD): number {
  const taller = rect.bottom - rect.top > box.bottom - box.top - 2 * pad
  if (taller || rect.top - pad < box.top) return rect.top - pad - box.top
  if (rect.bottom + pad > box.bottom) return rect.bottom + pad - box.bottom
  return 0
}
