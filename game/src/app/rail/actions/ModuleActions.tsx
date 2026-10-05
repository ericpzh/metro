// Contextual actions for the equipment being placed (§5.4 module options).
//
// Each tile is gated by what the piece actually supports: a future fixed-angle
// module simply loses its rotation tile — no other change needed. 指示牌 is
// turnable **and** composed, so it shows both: 旋转 turns the hung board, and
// 自定义 opens the board editor for the panel it will print (§5.8).
//
// The anchor helpers below are the single source for *where* this row belongs —
// the tile that spawned it, so it folds out right below its parent instead of at
// the folder bottom. Group-owned pieces anchor to their parent tile; plain gear
// anchors to its own tile. Null closes every row, letting the open one shrink
// away. Equipment and 装饰 folders both read them, so the two rows can never
// disagree about which tile owns a piece.

import { isBenchType, isBillboardType, isDecorType, isEscalatorType, isExitType, isGateType, isRotatableType, isStairType, useStore } from '../../store.ts'
import type { Tool } from '../../store.ts'
import type { GateDoor } from '../../../sim/types.ts'
import { Block } from '../shared/Block.tsx'

/** The 闸机 tile's Tab cycle, in the label the action tile wears. */
const GATE_DOOR_LABEL: Record<GateDoor, string> = { lane: '有门', fence: '围栏' }

/** True when the piece being placed owns at least one action tile. */
export function hasModuleActions(moduleType: string): boolean {
  return isRotatableType(moduleType) || moduleType === 'sign' || isStairType(moduleType) || isEscalatorType(moduleType) || isGateType(moduleType)
}

/** Anchor of the action row inside 设备, or null when no row is open. */
export function equipActionsAnchor(tool: Tool, moduleType: string): string | null {
  if (tool !== 'module' || isDecorType(moduleType) || !hasModuleActions(moduleType)) return null
  if (isStairType(moduleType)) return '__stair'
  if (isExitType(moduleType)) return '__exit'
  return moduleType
}

/** Anchor of the action row inside 装饰, or null when no row is open. */
export function decorActionsAnchor(tool: Tool, moduleType: string): string | null {
  if (tool !== 'module' || !isDecorType(moduleType) || !hasModuleActions(moduleType)) return null
  if (isBenchType(moduleType)) return '__bench'
  if (isBillboardType(moduleType)) return '__billboard'
  return moduleType
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
