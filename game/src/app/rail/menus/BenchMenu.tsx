// The 座椅 variant sub-menu (§5.4 platform furniture).
//
// Shares the single variant-expansion slot with the other sub-menus (see
// StairMenu.tsx). The options are a module-level filter — `MODULE_OPTIONS` is
// static, so this is the same list the old `useMemo([])` built, now shared by
// the 装饰 folder (for the parent tile's thumbnail) and this list.

import { MODULE_OPTIONS, isBenchType, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

export const benchOptions = MODULE_OPTIONS.filter((m) => isBenchType(m.id))

export function BenchMenu({ open, thumbs }: { open: boolean; thumbs: Record<string, string> }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const setModuleType = useStore((s) => s.setModuleType)
  return (
    <InlineExpand open={open}>
      {benchOptions.map((m) => (
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
