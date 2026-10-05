// The 设备 folder body (§5.4 equipment palette).
//
// Plain gear tiles plus the 楼梯 / 出入口 parent tiles, each with its variant
// sub-menu and the contextual action row (旋转 / 宽度 / …) folded out below the
// tile that spawned it. `gearOptions` is a module-level filter —
// `MODULE_OPTIONS` is static, so this is the same list the old `useMemo([])`
// built, now also readable by the shell for the folder count.

import { useEffect, useState } from 'react'
import { MODULE_OPTIONS, isDecorType, isExitType, isStairType, useStore } from '../../store.ts'
import { getModuleThumbnails } from '../../moduleThumbnails.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand, interleaveRows } from '../shared/InlinePanel.tsx'
import type { SubMenuKey } from '../helpers.ts'
import { StairMenu, stairOptions } from '../menus/StairMenu.tsx'
import { ExitMenu } from '../menus/ExitMenu.tsx'
import { ModuleActions, equipActionsAnchor } from '../actions/ModuleActions.tsx'

export const gearOptions = MODULE_OPTIONS.filter((m) => !isStairType(m.type) && !isDecorType(m.type) && !isExitType(m.id))

export function EquipmentFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
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

  // The nested variant sub-menus (楼梯 / 出入口) share one piece of state with
  // the rest of the rail, so at most one is expanded at a time.
  const stairOpen = subMenu === 'stair'
  const exitOpen = subMenu === 'exit'
  const actionsAnchor = equipActionsAnchor(tool, moduleType)

  return (
    <div className="blockGrid">
      {interleaveRows(
        [
          ...gearOptions.map((m) => ({
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
          {
            anchor: '__stair',
            node: (
              <Block
                key="__stair"
                label="楼梯"
                thumb={thumbs[stairOptions[0]?.id ?? '']}
                active={isStairType(moduleType)}
                submenu={stairOpen}
                onClick={() => onToggleSubMenu('stair')}
              />
            ),
          },
          {
            anchor: '__exit',
            node: (
              <Block
                key="__exit"
                label="出入口"
                thumb={thumbs['exit']}
                active={isExitType(moduleType)}
                submenu={exitOpen}
                onClick={() => onToggleSubMenu('exit')}
              />
            ),
          },
        ],
        (anchor) => {
          const rows: React.ReactNode[] = []
          if (anchor === '__stair') {
            rows.push(<StairMenu key="stair-variants" open={stairOpen} thumbs={thumbs} />)
          }
          if (anchor === '__exit') {
            rows.push(<ExitMenu key="exit-variants" open={exitOpen} thumbs={thumbs} />)
          }
          // The contextual action row for whichever equipment spawned it; every
          // other anchor stays mounted but closed so the old row shrinks while
          // the new one expands.
          rows.push(
            <InlineExpand key={`equip-actions-${anchor}`} open={actionsAnchor === anchor}>
              <ModuleActions />
            </InlineExpand>,
          )
          return rows
        },
      )}
    </div>
  )
}
