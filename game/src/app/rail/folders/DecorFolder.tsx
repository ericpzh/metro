// The 装饰 folder body (§5.4 decor palette).
//
// A thin wrapper: the grid itself — the plain decor tiles, the five variant families
// (座椅 / 广告牌 / 玻璃板 / 站名 / 线网图) with their sub-menus, and the contextual action row
// — is `rail/shared/TileGrid.tsx`, driven by the family table in
// `app/store/catalog.ts`. Nothing about the folder is written out here, which is the
// point: the folder, its parent tiles, its lists and the action row all read that one
// table, so they cannot disagree.

import { TileGrid } from '../shared/TileGrid.tsx'
import type { SubMenuKey } from '../helpers.ts'

export function DecorFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
  return <TileGrid folder="decor" subMenu={subMenu} onToggleSubMenu={onToggleSubMenu} />
}
