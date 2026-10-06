// Contextual actions for the equipment being placed (§5.4 module options).
//
// Each tile is gated by what the piece actually supports: a future fixed-angle
// module simply loses its rotation tile — no other change needed. 指示牌 is
// turnable **and** composed, so it shows both: 旋转 turns the hung board, and
// 自定义 opens the board editor for the panel it will print (§5.8).
//
// **Where the row belongs** is one rule, `actionsAnchorFor` in `app/store/catalog.ts`:
// the piece's **family tile** when it is a variant of one (座椅 / 广告牌 / 玻璃板 / 站名 /
// 线网图 / 楼梯 / 出入口) and the piece's own tile otherwise. The shared grid
// (`rail/shared/TileGrid.tsx`) renders the tiles and folds this row out under the same
// anchor, so the two cannot disagree — which is what a per-folder, hand-listed anchor
// used to get wrong (a variant whose 旋转 tile folded out under a tile no folder drew).
// Null closes every row, letting the open one fold away.

import { actionsAnchorFor, hasModuleActions, isEscalatorType, isGateType, isStairType, isRotatableType, useStore } from '../../store.ts'
import type { Tool } from '../../store.ts'
import type { GateDoor } from '../../../sim/types.ts'
import { Block } from '../shared/Block.tsx'

export { hasModuleActions } from '../../store.ts'

/** The 闸机 tile's Tab cycle, in the label the action tile wears. */
const GATE_DOOR_LABEL: Record<GateDoor, string> = { lane: '有门', fence: '围栏' }

/**
 * The tile the action row folds out under, or null when the tool is not placing a piece
 * that owns one. The folder needs no argument: a tile exists only in its own folder's
 * grid, so an anchor that folder does not draw simply never opens.
 */
export function actionsAnchor(tool: Tool, moduleType: string): string | null {
  if (tool !== 'module' || !hasModuleActions(moduleType)) return null
  return actionsAnchorFor(moduleType)
}

export function ModuleActions(): React.ReactElement {
  const moduleType = useStore((s) => s.moduleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const gateDoor = useStore((s) => s.gateDoor)
  const stairWidth = useStore((s) => s.stairWidth)
  const st = useStore.getState
  return (
    <>
      {isRotatableType(moduleType) ? (
        <Block
          label={`旋转 ${((4 - moduleRot) % 4) * 90}°`}
          icon="redo"
          shortcut="R"
          onClick={() => st().rotateModule()}
        />
      ) : null}
      {moduleType === 'sign' ? (
        <Block
          label="自定义"
          icon="board"
          onClick={() => st().openSignComposer()}
        />
      ) : null}
      {isStairType(moduleType) ? (
        <Block
          label={`宽度 ${stairWidth.toFixed(1)}m`}
          icon="ortho"
          shortcut="Tab"
          onClick={() => st().cycleStairWidth()}
        />
      ) : null}
      {isEscalatorType(moduleType) ? (
        <Block
          label={escalatorDir === 'up' ? '上行' : '下行'}
          icon={escalatorDir === 'up' ? 'up' : 'down'}
          shortcut="Tab"
          onClick={() => st().cycleEscalatorDir()}
        />
      ) : null}
      {isGateType(moduleType) ? (
        <Block
          label={GATE_DOOR_LABEL[gateDoor]}
          icon="turnstile"
          shortcut="Tab"
          onClick={() => st().cycleGateDoor()}
        />
      ) : null}
    </>
  )
}
