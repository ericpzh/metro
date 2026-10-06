// A folder's tile grid — **one** component for the 设备 and 装饰 folders (§5.4).
//
// Both folders are the same thing: the folder's **plain tiles**, then one **parent tile
// per variant family** whose sub-menu folds out under it, then the contextual action row
// (旋转 / 宽度 / …) under whichever tile spawned it. They used to be two ~110-line copies
// that each hand-listed their parent tiles, their open flags, their expansion switches
// and their action anchors — which is how a family could end up half-wired (a variant
// whose list folds away when it is picked, or a piece whose 旋转 tile folds out under a
// tile no folder draws).
//
// Everything this component needs comes from `app/store/catalog.ts`'s family table:
// `folderOptions(folder)` is the plain tiles, `familiesIn(folder)` the parents,
// `familyOptions(family)` the sub-menu, `familyAnchor` the tile an action row hangs
// under, `actionsAnchorFor` the anchor a placed piece asks for, and **`actionRowOpen`**
// whether that row is open right now. Adding a family is one row in that table — no edit
// here, and none in a folder, a menu or the actions.

import { useEffect, useState } from 'react'
import {
  actionRowOpen,
  actionsAnchorFor,
  familiesIn,
  familyAnchor,
  familyOptions,
  folderOptions,
  hasModuleActions,
  useStore,
  type ModuleFamily,
  type ModuleFolder,
} from '../../store.ts'
import { getModuleThumbnails } from '../../moduleThumbnails.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand, interleaveRows } from '../shared/InlinePanel.tsx'
import { VariantMenu } from '../menus/VariantMenu.tsx'
import { ModuleActions } from '../actions/ModuleActions.tsx'
import type { SubMenuKey } from '../helpers.ts'

export function TileGrid({
  folder,
  subMenu,
  onToggleSubMenu,
}: {
  folder: ModuleFolder
  subMenu: SubMenuKey | null
  onToggleSubMenu: (k: SubMenuKey) => void
}): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    void getModuleThumbnails().then((t) => {
      if (alive) setThumbs(t)
    })
    return () => {
      alive = false
    }
  }, [])

  // The family the piece being placed belongs to, if any: its tile lights up (`active`),
  // its list is the one that may be open, and its tile is where the action row folds out.
  // One derivation, so the tile, the list and the row cannot answer differently.
  const pieceFamily = familiesIn(folder).find((f) => f.owns(moduleType)) ?? null
  const pieceAnchor = tool === 'module' && hasModuleActions(moduleType) ? actionsAnchorFor(moduleType) : null
  const familyOpen = (family: ModuleFamily): boolean => subMenu === family.key
  // The list the player is looking at, as a family key — a paint sub-menu ('enamel') is
  // not a module family, and simply parks every action row while it is open.
  const openFamily = familiesIn(folder).find((f) => familyOpen(f))?.key ?? null

  return (
    <div className="blockGrid">
      {interleaveRows(
        [
          ...folderOptions(folder).map((m) => ({
            anchor: m.id,
            node: (
              <Block
                key={m.id}
                label={m.label}
                thumb={thumbs[m.id]}
                active={tool === 'module' && moduleType === m.id}
                onClick={() => {
                  setModuleType(m.id)
                  setTool('module')
                }}
              />
            ),
          })),
          ...familiesIn(folder).map((family) => ({
            anchor: familyAnchor(family.key),
            node: (
              <Block
                key={familyAnchor(family.key)}
                label={family.label}
                // The parent's icon is its first variant's, so a closed list still shows
                // what is behind it — the same rule for every family.
                thumb={thumbs[familyOptions(family)[0]?.id ?? '']}
                active={pieceFamily === family}
                submenu={familyOpen(family)}
                onClick={() => onToggleSubMenu(family.key)}
              />
            ),
          })),
        ],
        (anchor) => {
          const rows: React.ReactNode[] = []
          const family = familiesIn(folder).find((f) => familyAnchor(f.key) === anchor)
          if (family) {
            rows.push(<VariantMenu key={`${family.key}-variants`} family={family} open={familyOpen(family)} thumbs={thumbs} />)
          }
          // The contextual action row for whichever piece spawned it; every other anchor
          // stays mounted but closed, so the old row folds away while the new one opens.
          // It opens only under the family being browsed — or under the piece's own tile
          // when no list is open — because two tiles share a grid row and a full-width row
          // can only land *after* that pair: a row left open across a family the player is
          // no longer picking from reads as that family's (`actionRowOpen`).
          rows.push(
            <InlineExpand key={`actions-${anchor}`} open={actionRowOpen(anchor, pieceAnchor, openFamily)}>
              <ModuleActions />
            </InlineExpand>,
          )
          return rows
        },
      )}
    </div>
  )
}
