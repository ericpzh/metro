// The 楼梯 variant sub-menu (§5.4 vertical circulation).
//
// One of four nested variant lists that share a single expansion slot: opening
// one collapses the rest, and picking any module the sub-menu does not own
// collapses them all. The options are a module-level filter — `MODULE_OPTIONS`
// is static, so this is the same list the old `useMemo([])` built, now shared by
// the 设备 folder (for the parent tile's thumbnail) and this list.

import { MODULE_OPTIONS, isStairType, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

export const stairOptions = MODULE_OPTIONS.filter((m) => isStairType(m.type))

export function StairMenu({ open, thumbs }: { open: boolean; thumbs: Record<string, string> }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const setModuleType = useStore((s) => s.setModuleType)
  return (
    <InlineExpand open={open}>
      {stairOptions.map((m) => (
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
