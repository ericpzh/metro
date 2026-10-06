// The 工具 folder body (§4 pointer tools).
//
// 选择 / 吸取, 方块 / 删除, 墙, the 方块 tool's three cut pieces, 撤销 / 重做 and the
// generated-ring setting. The folder chrome (`Folder` + open state) stays with the rail
// shell; this file owns only what the folder shows.
//
// **It is laid out like every other folder.** The tiles are anchored rows passed through
// `interleaveRows` (`rail/shared/InlinePanel.tsx`), and each anchor mounts the **same**
// `ActionRow` (`rail/actions/ActionRow.tsx`) the 设备 / 装饰 grid mounts — so the 旋转 tile
// a 半墙 folds out is the very component, and the very open rule
// (`actionRowOpen`), that fold a 座椅's out. Which anchor is armed comes from
// `armedActionsAnchor` (`rail/helpers.ts`), the rail's one answer for pieces and cut
// pieces alike; nothing here asks whether a cut mode is on.
//
// The three cut pieces are a **table**, `CUT_MODES` (`app/store/catalog.ts`), the way the
// variant families are: one row per piece, with the label and the glyph its tile wears.
// Adding a fourth cut would be a row there, and no edit here.
// Each is picked on its own tile — one click for the piece the player wants, rather than a
// step through a cycle — and the plain 方块 tile is what leaves a cut mode (`setCutMode(null)`).
// **Tab** is the 生成墙壁 ring's key (below), not a walk through the pieces.

import { CUT_MODES, cutAnchor, useStore } from '../../store.ts'
import { armedActionsAnchor, armedCut, showsAutoWalls } from '../helpers.ts'
import { ActionRow } from '../actions/ActionRow.tsx'
import { Block } from '../shared/Block.tsx'
import { interleaveRows } from '../shared/InlinePanel.tsx'

/**
 * The generated-ring tile's own anchor. It hangs no row — the ring is a **setting of the
 * tool**, not an action of an armed piece — but every tile in a grid is addressed by an
 * anchor, so it wears one like the rest. **Tab** is this tile's key (`AppShell.tsx`).
 */
const AUTO_WALLS_TILE = '__autoWalls'

export function ToolsFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const autoWalls = useStore((s) => s.autoWalls)
  // Which cut piece owns the click, from the one place those fields are read as the
  // single thing they mean — which tile lights up, and whether the ring tile is drawn.
  const cut = useStore(armedCut)
  const pieceAnchor = useStore(armedActionsAnchor)
  const st = useStore.getState

  // Every tile carries its own key: `interleaveRows` returns the row as an array, the way
  // `TileGrid`'s tiles do.
  const tiles: Array<{ anchor: string; node: React.ReactNode }> = [
    { anchor: 'select', node: <Block key="select" label="选择" icon="select" shortcut="Z" active={tool === 'select'} onClick={() => setTool('select')} /> },
    { anchor: 'pick', node: <Block key="pick" label="吸取" icon="pick" shortcut="P" active={tool === 'pick'} onClick={() => setTool('pick')} /> },
    {
      anchor: 'block',
      node: (
        <Block
          key="block"
          label="方块"
          icon="block"
          shortcut="F"
          active={tool === 'block' && cut === null}
          onClick={() => {
            setTool('block')
            // Leaving a cut mode is what the plain tile means; when it is already plain,
            // leave the 生成墙壁 setting exactly as the player left it.
            if (cut !== null) st().setCutMode(null)
          }}
        />
      ),
    },
    { anchor: 'delete', node: <Block key="delete" label="删除" icon="delete" shortcut="B" active={tool === 'delete'} onClick={() => setTool('delete')} /> },
    { anchor: 'wall', node: <Block key="wall" label="墙" icon="wall" shortcut="G" active={tool === 'wall'} onClick={() => setTool('wall')} /> },
    // The cut pieces, straight from the table: one tile per row of `CUT_MODES`, its own
    // id for an anchor, its own id on `data-tile` (so **Tab**-ing to it scrolls it into
    // view like any armed piece), and the one `setCutMode` call to arm it.
    ...CUT_MODES.map((c) => ({
      anchor: cutAnchor(c.id),
      node: (
        <Block
          key={cutAnchor(c.id)}
          label={c.label}
          icon={c.icon}
          tile={cutAnchor(c.id)}
          active={tool === 'block' && cut === c.id}
          onClick={() => {
            setTool('block')
            st().setCutMode(c.id)
          }}
        />
      ),
    })),
    { anchor: 'undo', node: <Block key="undo" label="撤销" icon="undo" shortcut="Ctrl+Z" onClick={() => st().undo()} /> },
    { anchor: 'redo', node: <Block key="redo" label="重做" icon="redo" shortcut="Ctrl+Y" onClick={() => st().redo()} /> },
  ]

  // The ring's own tile, and only while it has something to say: a cut piece *is* the wall
  // a patch would otherwise grow, so with one armed the tile is not drawn at all rather
  // than greyed out beside the pieces the player can use — and **Tab**, its key, is refused
  // for the same reason (`setAutoWalls`).
  if (showsAutoWalls(tool, cut)) {
    tiles.push({
      anchor: AUTO_WALLS_TILE,
      node: (
        <Block
          key={AUTO_WALLS_TILE}
          label="生成墙壁"
          icon="wall"
          shortcut="Tab"
          active={autoWalls}
          onClick={() => st().setAutoWalls(!autoWalls)}
        />
      ),
    })
  }

  return (
    <div className="blockGrid">
      {interleaveRows(tiles, (anchor) => [
        // The one row: a tile that owns no actions never opens it, and the cut tiles'
        // 旋转 arrives under them exactly as a 座椅's 旋转 arrives under the 座椅.
        <ActionRow key={`actions-${anchor}`} anchor={anchor} pieceAnchor={pieceAnchor} openFamily={null} />,
      ])}
    </div>
  )
}
