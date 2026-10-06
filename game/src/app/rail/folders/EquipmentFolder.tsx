// The 设备 folder body (§5.4 equipment palette).
//
// A thin wrapper: the grid itself — the plain gear tiles, the two variant families
// (楼梯 / 出入口) with their sub-menus, and the contextual action row — is
// `rail/shared/TileGrid.tsx`, driven by the family table in `app/store/catalog.ts`.

import { TileGrid } from '../shared/TileGrid.tsx'
import type { SubMenuKey } from '../helpers.ts'

export function EquipmentFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
  return <TileGrid folder="equipment" subMenu={subMenu} onToggleSubMenu={onToggleSubMenu} />
}
