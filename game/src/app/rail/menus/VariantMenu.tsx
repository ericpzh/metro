// The rail's variant sub-menu — **one** component for every family (§5.4).
//
// A family's variants are a list of palette tiles, and every family's list behaves
// identically: it folds out under its parent tile, shares the rail's single open slot
// with the others, and picking a variant selects that piece (keeping the list open,
// because the list's family is the piece's family). 楼梯, 出入口, 座椅, 广告牌, 玻璃板,
// 站名 and 线网图 were seven copies of this component before; they are one now, driven by
// the family row in `app/store/catalog.ts`, so a family's labels and tooltips are data
// (`tileLabel` / `title`) rather than a seventh file, and a new family needs no UI code
// at all.
//
// Nothing here decides what a family *is*: it renders `familyOptions(family)`. The
// consistency that used to be maintained by hand — the parent tile's thumbnail, the
// open slot, the action row's anchor — is `TileGrid`'s and `actionsAnchorFor`'s, read
// from the same table.

import { familyOptions, type ModuleFamily } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'
import { useStore } from '../../store.ts'

export function VariantMenu({ family, open, thumbs }: { family: ModuleFamily; open: boolean; thumbs: Record<string, string> }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const setModuleType = useStore((s) => s.setModuleType)
  return (
    <InlineExpand open={open}>
      {familyOptions(family).map((m) => (
        <Block
          key={m.id}
          label={family.tileLabel ? family.tileLabel(m) : m.label}
          title={family.title ? family.title(m) : undefined}
          thumb={thumbs[m.id]}
          active={tool === 'module' && moduleType === m.id}
          onClick={() => {
            setModuleType(m.id)
            setTool('module')
          }}
        />
      ))}
    </InlineExpand>
  )
}
