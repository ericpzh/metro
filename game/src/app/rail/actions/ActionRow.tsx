// Every contextual action tile in the rail, and the one row they fold out in (§5.4).
//
// An action row belongs to the thing the rail is **armed with**, not to a folder: a
// 座椅 with a 旋转, a 楼梯 with a 窄/中/宽, a 闸机 with a door, a 半墙 with a 旋转 to
// the other half of its cell. Pick the tile the thing belongs to and its actions
// fold out underneath, in whichever folder that tile lives in.
//
// So there is **one** row for the whole rail — this component — and every grid that
// draws tiles with actions mounts it under each of its tiles: `rail/shared/TileGrid.tsx`
// for 设备 / 装饰 and `rail/folders/ToolsFolder.tsx` for the 方块 tool's cut pieces. A
// tile that owns no actions simply never opens its row, so no folder has to ask
// whether it should draw one.
//
// **Neither the anchor nor the open rule is decided here.** The anchor comes from
// `armedActionsAnchor` (`rail/helpers.ts`), which answers for a piece and a cut mode
// through the same table, and the open rule is `actionRowOpen` (`app/store/catalog.ts`),
// which lives with the family table because two tiles share a grid row and a full-width
// row can only land *after* that pair — a row left open across a family the player is no
// longer picking from reads as that family's.
//
// The tiles themselves are gated by what the armed thing actually supports: a
// fixed-angle module owns no rotation tile, a 半墙 owns one because which half of the
// cell it keeps is the player's choice. Adding an action to something new is a row here
// (and a predicate beside it), never a copy of this fold.

import {
  actionRowOpen,
  isEscalatorType,
  isGateType,
  isRotatableType,
  isSignType,
  isStairType,
  useStore,
  type ModuleFamilyKey,
} from '../../store.ts'
import { armedCut } from '../helpers.ts'
import { stairWidthLabel } from '../../../sim/stairs.ts'
import type { GateDoor } from '../../../sim/types.ts'
import { Block } from '../shared/Block.tsx'
import { RotateTile } from '../shared/RotateTile.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

/** The 闸机 tile's Tab cycle, in the label the action tile wears. */
const GATE_DOOR_LABEL: Record<GateDoor, string> = { lane: '有门', fence: '围栏' }

/**
 * One anchor's action row: the fold, the open rule and the tiles. A folder mounts one
 * under every tile it draws — so spawning this logic is the same line in every folder —
 * and the rows of tiles that own no actions stay shut.
 */
export function ActionRow({
  anchor,
  pieceAnchor,
  openFamily,
}: {
  /** The tile this row folds out under: the folder's own anchor id. */
  anchor: string
  /** The tile the armed thing's row belongs to (`armedActionsAnchor`), or null. */
  pieceAnchor: string | null
  /** The variant list the player is looking at, when the anchor is a family's tile. */
  openFamily: ModuleFamilyKey | null
}): React.ReactElement {
  return (
    <InlineExpand open={actionRowOpen(anchor, pieceAnchor, openFamily)}>
      <ActionTiles />
    </InlineExpand>
  )
}

/**
 * The tiles of whichever thing is armed — the **only** place an action tile is declared.
 *
 * Each block of tiles answers to its own armed thing, so the row a folder folds out is
 * the piece's (or the cut's) whatever folder it is in. The cut pieces come first: a cut
 * is armed on the 方块 tool, which places no module at all, so the two can never both be
 * live — and the guards say so rather than relying on that.
 */
function ActionTiles(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const moduleRot = useStore((s) => s.moduleRot)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const gateDoor = useStore((s) => s.gateDoor)
  const stairWidth = useStore((s) => s.stairWidth)
  const st = useStore.getState
  // The cut piece the 方块 click will lay, if any: its orientation is the one thing a
  // cut can be told about, and it is the same counter **R** turns.
  const cutArmed = useStore(armedCut)
  const cut = tool === 'block' ? cutArmed : null
  const piece = tool === 'module' ? moduleType : null
  return (
    <>
      {cut !== null ? (
        <RotateTile label="旋转" onClick={() => st().rotateWallSnap()} />
      ) : null}
      {piece !== null && isRotatableType(piece) ? (
        <RotateTile label={`旋转 ${((4 - moduleRot) % 4) * 90}°`} onClick={() => st().rotateModule()} />
      ) : null}
      {/* Both 指示牌 mounts — the hung board and the wall board — are composed on the
          same board editor, so the tile follows the piece and not one palette id. */}
      {piece !== null && isSignType(piece) ? (
        <Block
          label="自定义"
          icon="board"
          onClick={() => st().openSignComposer()}
        />
      ) : null}
      {piece !== null && isStairType(piece) ? (
        <Block
          label={stairWidthLabel(stairWidth)}
          icon="ortho"
          shortcut="Tab"
          onClick={() => st().cycleStairWidth()}
        />
      ) : null}
      {piece !== null && isEscalatorType(piece) ? (
        <Block
          label={escalatorDir === 'up' ? '上行' : '下行'}
          icon={escalatorDir === 'up' ? 'up' : 'down'}
          shortcut="Tab"
          onClick={() => st().cycleEscalatorDir()}
        />
      ) : null}
      {piece !== null && isGateType(piece) ? (
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
