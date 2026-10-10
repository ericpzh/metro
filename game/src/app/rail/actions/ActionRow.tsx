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
  isBenchType,
  isEscalatorType,
  isGateType,
  isRotatableType,
  isSignType,
  isStairType,
  useStore,
  type ModuleFamilyKey,
} from '../../store.ts'
import { AiOutlineColumnHeight } from 'react-icons/ai'
import { RiExpandWidthFill } from 'react-icons/ri'
import { armedCut } from '../helpers.ts'
import { stairWidthLabel } from '../../../sim/stairs.ts'
import { roofWidthLabel } from '../../../sim/structures.ts'
import type { GateDoor } from '../../../sim/types.ts'
import { Block } from '../shared/Block.tsx'
import { PositionTile, RotateTile } from '../shared/RotateTile.tsx'
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
  const lines = useStore((s) => s.station.lines)
  const railLineId = useStore((s) => s.railLineId)
  const floorLine = lines.find((l) => l.id === railLineId) ?? lines.find((l) => l.id === '5') ?? lines[0]
  const guideExitId = useStore((s) => s.guideExitId)
  const exits = useStore((s) => s.station.modules).filter((m) => m.type === 'exit')
  const selectedExitId = exits.find((m) => m.id === guideExitId)?.id ?? exits[0]?.id
  const lightPosition = useStore((s) => s.lightPosition)
  const escalatorDir = useStore((s) => s.escalatorDir)
  const escalatorWide = useStore((s) => s.escalatorWide)
  const escalatorLong = useStore((s) => s.escalatorLong)
  const liftStyle = useStore((s) => s.liftStyle)
  const hangerLength = useStore((s) => s.hangerLength)
  const curtainWidth = useStore((s) => s.curtainWidth)
  const psdEndHeight = useStore((s) => s.psdEndHeight)
  const gateDoor = useStore((s) => s.gateDoor)
  const stairWidth = useStore((s) => s.stairWidth)
  const doorWide = useStore((s) => s.doorWide)
  const stairBlockHeight = useStore((s) => s.stairBlockHeight)
  const pillarLength = useStore((s) => s.pillarLength)
  const roofWidth = useStore((s) => s.roofWidth)
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
        piece.startsWith('pillar-slim')
          ? <PositionTile position={moduleRot} onClick={() => st().rotateModule()} />
          : <RotateTile label={`旋转 ${piece === 'light-rectangular' ? (moduleRot % 2) * 90 : ((4 - moduleRot) % 4) * 90}°`} onClick={() => st().rotateModule()} />
      ) : null}
      {piece === 'psd-end' ? (
        <Block label={psdEndHeight === 'half' ? '半高' : '全高'} art={<AiOutlineColumnHeight />} shortcut="Tab" onClick={() => st().cyclePsdEndHeight()} />
      ) : null}
      {piece === 'floor-mark-direction' ? (
        <div className="floorLineTiles" role="group" aria-label="选择地面指引线路">
          {lines.length ? lines.map((line) => <Block key={line.id} label={line.name} tone={line.colour} active={floorLine?.id === line.id} onClick={() => st().setRailLine(line.id)} />) : <span>暂无线路</span>}
        </div>
      ) : null}
      {piece === 'hanger-roof' || piece === 'hanger-post' ? (
        <Block label={hangerLength === 4 ? '短' : hangerLength === 6 ? '中' : '长'} art={<RiExpandWidthFill />} shortcut="Tab" onClick={() => st().cycleHangerLength()} />
      ) : null}
      {piece === 'curtain-wall' ? (
        <Block label={curtainWidth === 1 ? '超窄' : curtainWidth === 2 ? '窄' : curtainWidth === 3 ? '中' : '宽'} art={<RiExpandWidthFill />} shortcut="Tab" onClick={() => st().cycleCurtainWidth()} />
      ) : null}
      {piece !== null && piece.startsWith('pillar') ? (
        <Block label={pillarLength === 2 ? '短' : '长'} art={<AiOutlineColumnHeight />} shortcut="Tab" onClick={() => st().togglePillarLength()} />
      ) : null}
      {piece === 'lift' ? (
        <Block label={liftStyle === 'glass' ? '玻璃' : '钢板'} icon="block" shortcut="Tab" onClick={() => st().cycleLiftStyle()} />
      ) : null}
      {piece === 'guidepost' ? (
        <div className="guideExitTiles" role="group" aria-label="选择出入口">
          {exits.length === 0 ? <span>暂无出入口</span> : exits.map((exit) => (
            <button type="button" key={exit.id} aria-pressed={selectedExitId === exit.id} onClick={() => st().setGuideExitId(exit.id)}>{exit.cfg.name || '口'}</button>
          ))}
        </div>
      ) : null}
      {piece === 'light-rectangular' ? (
        <PositionTile position={lightPosition} shortcut="Tab" onClick={() => st().cycleLightPosition()} />
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
      {piece !== null && isBenchType(piece) ? (
        <Block label={piece.endsWith('-2') ? '宽' : '窄'} art={<RiExpandWidthFill />} shortcut="Tab" onClick={() => st().cycleBenchWidth()} />
      ) : null}
      {piece !== null && isStairType(piece) ? (
        <Block
          label={piece === 'stair-block' ? stairBlockHeight === 1 ? '高' : '矮' : stairWidthLabel(stairWidth)}
          art={piece === 'stair-block' ? <AiOutlineColumnHeight /> : <RiExpandWidthFill />}
          shortcut="Tab"
          onClick={() => st().cycleStairWidth()}
        />
      ) : null}
      {piece !== null && piece.startsWith('door-') ? (
        <Block label={doorWide ? '宽' : '窄'} art={<RiExpandWidthFill />} shortcut="Tab" onClick={() => st().toggleDoorWidth()} />
      ) : null}
      {piece !== null && (piece === 'roof-shell' || piece === 'roof-truss' || piece === 'roof-tapered') ? (
        <Block
          label={roofWidthLabel(roofWidth)}
          art={<RiExpandWidthFill />}
          shortcut="Tab"
          onClick={() => st().cycleRoofWidth()}
        />
      ) : null}
      {piece !== null && isEscalatorType(piece) ? (
        <>
          <Block
            label={escalatorDir === 'up' ? '上行' : '下行'}
            icon={escalatorDir === 'up' ? 'up' : 'down'}
            shortcut="Tab"
            onClick={() => st().cycleEscalatorDir()}
          />
          <Block label={escalatorWide ? '宽' : '窄'} art={<RiExpandWidthFill />} onClick={() => st().toggleEscalatorWidth()} />
          <Block label={escalatorLong ? '长' : '短'} art={<AiOutlineColumnHeight />} onClick={() => st().toggleEscalatorLength()} />
        </>
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
