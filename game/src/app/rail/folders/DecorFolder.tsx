// The 装饰 folder body (§5.4 decor palette).
//
// Plain decor tiles plus the 座椅 / 广告牌 parent tiles, each with its variant
// sub-menu and the contextual action row folded out below the tile that spawned
// it. `decorOptions` is a module-level filter — `MODULE_OPTIONS` is static, so
// this is the same list the old `useMemo([])` built, now also readable by the
// shell for the folder count.

import { useEffect, useState } from 'react'
import { MODULE_OPTIONS, isBenchType, isBillboardType, isDecorType, useStore } from '../../store.ts'
import { getModuleThumbnails } from '../../moduleThumbnails.ts'
import { Block } from '../shared/Block.tsx'
import { InlineExpand, interleaveRows } from '../shared/InlinePanel.tsx'
import type { SubMenuKey } from '../helpers.ts'
import { BenchMenu, benchOptions } from '../menus/BenchMenu.tsx'
import { BillboardMenu, billboardOptions } from '../menus/BillboardMenu.tsx'
import { ModuleActions, decorActionsAnchor } from '../actions/ModuleActions.tsx'

export const decorOptions = MODULE_OPTIONS.filter((m) => isDecorType(m.type) && !isBillboardType(m.id) && !isBenchType(m.id))

export function DecorFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (k: SubMenuKey) => void }): React.ReactElement {
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

  // The nested variant sub-menus (座椅 / 广告牌) share one piece of state with
  // the rest of the rail, so at most one is expanded at a time.
  const benchOpen = subMenu === 'bench'
  const billboardOpen = subMenu === 'billboard'
  const actionsAnchor = decorActionsAnchor(tool, moduleType)

  return (
    <div className="blockGrid">
      {interleaveRows(
        [
          ...decorOptions.map((m) => ({
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
            anchor: '__bench',
            node: (
              <Block
                key="__bench"
                label="座椅"
                thumb={thumbs[benchOptions[0]?.id ?? '']}
                active={isBenchType(moduleType)}
                submenu={benchOpen}
                onClick={() => onToggleSubMenu('bench')}
              />
            ),
          },
          {
            anchor: '__billboard',
            node: (
              <Block
                key="__billboard"
                label="广告牌"
                thumb={thumbs[billboardOptions[0]?.id ?? '']}
                active={isBillboardType(moduleType)}
                submenu={billboardOpen}
                onClick={() => onToggleSubMenu('billboard')}
              />
            ),
          },
        ],
        (anchor) => {
          const rows: React.ReactNode[] = []
          if (anchor === '__bench') {
            rows.push(<BenchMenu key="bench-variants" open={benchOpen} thumbs={thumbs} />)
          }
          if (anchor === '__billboard') {
            rows.push(<BillboardMenu key="billboard-variants" open={billboardOpen} thumbs={thumbs} />)
          }
          rows.push(
            <InlineExpand key={`decor-actions-${anchor}`} open={actionsAnchor === anchor}>
              <ModuleActions />
            </InlineExpand>,
          )
          return rows
        },
      )}
    </div>
  )
}
