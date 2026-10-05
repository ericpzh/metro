// The 工具 folder body (§4 pointer tools).
//
// 选择 / 地基 (+自动生成墙壁 + 半墙 tiles) / 墙 / 删除, plus undo-redo. The
// folder chrome (`Folder` + open state) stays with the rail shell; this file
// owns only what the folder shows.

import { useStore } from '../../store.ts'
import type { Tool } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

export function ToolsFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const autoWalls = useStore((s) => s.autoWalls)
  const halfWall = useStore((s) => s.halfWall)
  const st = useStore.getState
  return (
    <div className="blockGrid">
      {(
        [
          { id: 'select', label: '选择', icon: 'select', shortcut: 'Z' },
          {
            id: 'block',
            label: '地基',
            icon: 'block',
            shortcut: 'F',
          },
          { id: 'wall', label: '墙', icon: 'wall', shortcut: 'G' },
          {
            id: 'delete',
            label: '删除',
            icon: 'delete',
            shortcut: 'B',
          },
        ] as Array<{ id: Tool; label: string; icon: string; shortcut?: string }>
      ).map((t) => (
        <Block
          key={t.id}
          label={t.label}
          icon={t.icon}
          shortcut={t.shortcut}
          active={tool === t.id}
          onClick={() => setTool(t.id)}
        />
      ))}
      <Block label="撤销" icon="undo" shortcut="Ctrl+Z" onClick={() => st().undo()} />
      <Block label="重做" icon="redo" shortcut="Ctrl+Y" onClick={() => st().redo()} />
      {tool === 'block' && (
        <Block
          label="自动生成墙壁"
          icon="wall"
          active={autoWalls}
          disabled={halfWall}
          shortcut="Tab"
          onClick={() => st().setAutoWalls(!autoWalls)}
        />
      )}
      {tool === 'block' && (
        <Block
          label="半墙"
          icon="halfwall"
          active={halfWall}
          onClick={() => st().toggleHalfWall()}
        />
      )}
    </div>
  )
}
