// The 工具 folder body (§4 pointer tools).
//
// 选择 / 方块 (+自动生成墙壁 + the 切角 tile) / 墙 / 删除, plus undo-redo. The
// folder chrome (`Folder` + open state) stays with the rail shell; this file
// owns only what the folder shows.
//
// The two tiles the 方块 tool adds are its two choices, and **Tab is on the cut
// tile**: it steps 半墙 → 三角上 → 三角下 → off, which is the question a 方块 click
// answers — what shape does this one lay. 自动生成墙壁, which used to hold Tab, is off
// when the game opens and is asked for here instead: the ring is the one thing the
// tool does that the player did not draw.

import { useStore } from '../../store.ts'
import type { Tool } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

/**
 * The 方块 tool's cut modes, as the one tile that steps them: 半墙 → 三角上 → 三角下
 * → off, and round again. They share a button because they are one question —
 * what shape does this click lay — and **R** turns the piece whichever of the three
 * is showing; the label says which is live, so the tile is its own readout.
 */
const CUT_MODES = [
  { label: '半墙', icon: 'halfwall', hint: '半墙：点一下铺一层半块厚的墙，R 换它靠哪半边' },
  { label: '三角上', icon: 'triUpper', hint: '三角上：点一下铺一层上半三角，R 换它占哪个角' },
  { label: '三角下', icon: 'triLower', hint: '三角下：点一下铺一层下半三角，R 换它占哪个角' },
] as const

export function ToolsFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const autoWalls = useStore((s) => s.autoWalls)
  const halfWall = useStore((s) => s.halfWall)
  const triangles = useStore((s) => s.triangles)
  const triKind = useStore((s) => s.triKind)
  const st = useStore.getState
  const cut = halfWall ? CUT_MODES[0] : triangles ? (triKind === 'upper' ? CUT_MODES[1] : CUT_MODES[2]) : null
  return (
    <div className="blockGrid">
      {(
        [
          { id: 'select', label: '选择', icon: 'select', shortcut: 'Z' },
          {
            id: 'block',
            label: '方块',
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
          disabled={cut !== null}
          title={
            cut === null
              ? '自动生成墙壁：拖动方块时沿外圈长出 4 m 墙（默认关闭，点一下打开）'
              : '自动生成墙壁：切角模式占用中，退出切角后可打开'
          }
          onClick={() => st().setAutoWalls(!autoWalls)}
        />
      )}
      {tool === 'block' && (
        <Block
          label={cut === null ? '切角' : cut.label}
          icon={cut === null ? 'halfwall' : cut.icon}
          shortcut="Tab"
          title={cut === null ? '切角（Tab）：在 半墙 / 三角上 / 三角下 / 关 之间切换' : cut.hint}
          active={cut !== null}
          onClick={() => st().cycleCutMode()}
        />
      )}
    </div>
  )
}
