// The 广告牌 variant sub-menu (§5.4 billboard formats).
//
// Shares the single variant-expansion slot with the other sub-menus (see
// StairMenu.tsx). The options are a module-level filter — `MODULE_OPTIONS` is
// static, so this is the same list the old `useMemo([])` built, now shared by
// the 装饰 folder (for the parent tile's thumbnail) and this list.

import { MODULE_OPTIONS, isBillboardType, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

export const billboardOptions = MODULE_OPTIONS.filter((m) => isBillboardType(m.id))

export function BillboardMenu({ open, thumbs }: { open: boolean; thumbs: Record<string, string> }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const setModuleType = useStore((s) => s.setModuleType)
  return (
    <InlineExpand open={open}>
      {billboardOptions.map((m) => (
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
      ))}
    </InlineExpand>
  )
}
