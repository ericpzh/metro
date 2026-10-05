// The 出入口 variant sub-menu (§5.4 station exits).
//
// Shares the single variant-expansion slot with the other sub-menus (see
// StairMenu.tsx). The options are a module-level filter — `MODULE_OPTIONS` is
// static, so this is the same list the old `useMemo([])` built, now shared by
// the 设备 folder (for the parent tile's active state) and this list.

import { MODULE_OPTIONS, isExitType, useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

export const exitOptions = MODULE_OPTIONS.filter((m) => isExitType(m.id))

export function ExitMenu({ open, thumbs }: { open: boolean; thumbs: Record<string, string> }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const setModuleType = useStore((s) => s.setModuleType)
  return (
    <InlineExpand open={open}>
      {exitOptions.map((m) => (
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
