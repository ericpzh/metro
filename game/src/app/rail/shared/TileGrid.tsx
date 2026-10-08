// A folder's tile grid â€” **one** component for the è®¾å¤‡ and è£…é¥° folders (Â§5.4).
//
// Both folders are the same thing: the folder's **tiles in rail order** â€” its plain tiles
// and one **parent tile per variant family**, interleaved the way the catalogue's
// `RAIL_ORDER` lays them out, so a family sits in the row the palette puts it in â€” then the
// contextual action row (æ—‹è½¬ / è‡ªå®šä¹‰ / â€¦) under whichever tile spawned it. They used to be
// two ~110-line copies that each hand-listed their parent tiles, their open flags, their
// expansion switches and their action anchors â€” which is how a family could end up
// half-wired (a variant whose list folds away when it is picked, or a piece whose æ—‹è½¬ tile
// folds out under a tile no folder draws).
//
// Everything this component needs comes from `app/store/catalog.ts`: `folderTiles(folder)`
// is the grid's tiles in that order, each one already known to be a plain tile or a family,
// and `familyOptions(family)` is a family's sub-menu. The two things that are **not** about
// families come from the pieces of every folder that shares them: the anchor the armed
// thing's row belongs to is `armedActionsAnchor` (`rail/helpers.ts`, which answers for a
// piece and a cut mode alike) and the row itself is `ActionRow`
// (`rail/actions/ActionRow.tsx`) â€” the very component the å·¥å…· folder mounts under its cut
// tiles, so the fold, the open rule and the tiles exist once for the whole rail. Adding a
// family is one row in that table, and moving one is one line in `RAIL_ORDER` â€” no edit
// here, and none in a folder, a menu or the actions.

import { useEffect, useState } from 'react'
import {
  familiesIn,
  familyOptions,
  folderTiles,
  useStore,
  type ModuleFamily,
  type ModuleFolder,
} from '../../store.ts'
import { armedActionsAnchor } from '../helpers.ts'
import { getModuleThumbnails } from '../../moduleThumbnails.ts'
import { Block } from '../shared/Block.tsx'
import { interleaveRows } from '../shared/InlinePanel.tsx'
import { VariantMenu } from '../menus/VariantMenu.tsx'
import { ActionRow } from '../actions/ActionRow.tsx'
import type { SubMenuKey } from '../helpers.ts'

export function TileGrid({
  folder,
  subMenu,
  onToggleSubMenu,
  embedded = false,
}: {
  embedded?: boolean
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
  // Which tile the armed piece's action row folds out under. Read from the one
  // derivation the whole rail shares (`armedActionsAnchor`), so a folder never decides
  // this for itself â€” the cut pieces in the å·¥å…· folder ask the same question.
  const pieceAnchor = useStore(armedActionsAnchor)
  const familyOpen = (family: ModuleFamily): boolean => subMenu === family.key
  // The list the player is looking at, as a family key â€” a paint sub-menu ('enamel') is
  // not a module family, and simply parks every action row while it is open.
  const openFamily = familiesIn(folder).find((f) => familyOpen(f))?.key ?? null

  // The folder's tiles in rail order: the plain ones and each family's parent tile,
  // already interleaved by the catalogue's one order table, so this component never
  // decides what shares a row with what or where a family's list folds out.
  const tiles = folderTiles(folder)

  const rows = interleaveRows(
        tiles.map((tile) => ({
          anchor: tile.anchor,
          node:
            tile.kind === 'family' ? (
              <Block
                key={tile.anchor}
                label={tile.family.label}
                tile={tile.anchor}
                // The parent's icon is its first variant's, so a closed list still shows
                // what is behind it â€” the same rule for every family.
                thumb={folder === 'rail' ? undefined : thumbs[familyOptions(tile.family)[0]?.id ?? '']}
                icon={folder === 'rail' ? tile.family.key : undefined}
                active={pieceFamily === tile.family}
                submenu={familyOpen(tile.family)}
                onClick={() => onToggleSubMenu(tile.family.key)}
              />
            ) : (
              <Block
                key={tile.anchor}
                label={tile.option.label}
                tile={tile.option.id}
                thumb={folder === 'rail' ? undefined : thumbs[tile.option.id]}
                icon={folder === 'rail' ? tile.option.id : undefined}
                active={tool === 'module' && moduleType === tile.option.id}
                onClick={() => {
                  setModuleType(tile.option.id)
                  setTool('module')
                }}
              />
            ),
        })),
        (anchor) => {
          const rows: React.ReactNode[] = []
          const tile = tiles.find((t) => t.anchor === anchor)
          if (tile?.kind === 'family') {
            rows.push(<VariantMenu key={`${tile.family.key}-variants`} family={tile.family} open={familyOpen(tile.family)} thumbs={thumbs} />)
          }
          // The contextual action row for whichever piece spawned it; every other anchor
          // stays mounted but closed, so the old row folds away while the new one opens.
          // The row itself â€” the fold, the open rule and the tiles â€” is `ActionRow`, the
          // same component the å·¥å…· folder mounts for the cut pieces.
          rows.push(<ActionRow key={`actions-${anchor}`} anchor={anchor} pieceAnchor={pieceAnchor} openFamily={openFamily} />)
          return rows
        },
      )
  return embedded ? <>{rows}</> : <div className="blockGrid">{rows}</div>
}
