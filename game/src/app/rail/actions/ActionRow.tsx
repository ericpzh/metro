import { msg, translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
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
  moduleBuilderAttributes,
  isSignType,
  useStore,
  type ModuleFamilyKey,
} from '../../store.ts'
import { LuArrowUpToLine } from 'react-icons/lu'
import { LuArrowDownToLine } from 'react-icons/lu'
import { armedCut } from '../helpers.ts'
import type { BuilderAttribute } from '../../store/builderAttributes.ts'
import { DimensionArt, DirectionArt, LiftSizeArt, StoreyArt } from '../shared/AttributeArt.tsx'
import { dimensionMarkAlign } from '../shared/dimensionMark.ts'
import { dimensionSelection } from '../shared/dimensionSelection.ts'
import { Block } from '../shared/Block.tsx'
import { PositionTile, RotateTile } from '../shared/RotateTile.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

import type { AppState } from '../../store/Store.ts'

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
  useLanguage()
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
  useLanguage()
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const lines = useStore((s) => s.station.lines)
  const railLineId = useStore((s) => s.railLineId)
  const floorLine = lines.find((l) => l.id === railLineId) ?? lines.find((l) => l.id === '5') ?? lines[0]
  const guideExitId = useStore((s) => s.guideExitId)
  const exits = useStore((s) => s.station.modules).filter((m) => m.type === 'exit')
  const selectedExitId = exits.find((m) => m.id === guideExitId)?.id ?? exits[0]?.id
  const st = useStore.getState
  // The cut piece the 方块 click will lay, if any: its orientation is the one thing a
  // cut can be told about, and it is the same counter **R** turns.
  const cutArmed = useStore(armedCut)
  const cut = tool === 'block' ? cutArmed : null
  const piece = tool === 'module' ? moduleType : null
  const state = useStore((s) => s)
  return (
    <>
      {cut !== null ? (
        <RotateTile rotation={state.wallSnapCycle} label={t('rotate')} onClick={() => st().rotateWallSnap()} />
      ) : null}
      {piece !== null ? moduleBuilderAttributes(piece, state).map((attribute, index) => <BuilderAttributeTile key={`${attribute.kind}-${index}`} attribute={attribute} moduleType={piece} state={state} />) : null}
      {piece === 'floor-mark-direction' ? (
        <div className="floorLineTiles" role="group" aria-label={t('choose_floor_guide_line')}>
          {lines.length ? lines.map((line) => <Block key={line.id} label={line.name} tone={line.colour} active={floorLine?.id === line.id} onClick={() => st().setRailLine(line.id)} />) : <span>{t('no_lines_yet')}</span>}
        </div>
      ) : null}
      {piece === 'guidepost' ? (
        <div className="guideExitTiles" role="group" aria-label={t('choose_exit')}>
          {exits.length === 0 ? <span>{t('no_exits_yet')}</span> : exits.map((exit) => (
            <button type="button" key={exit.id} aria-pressed={selectedExitId === exit.id} onClick={() => st().setGuideExitId(exit.id)}>{translate(exit.cfg.name || msg('exit'))}</button>
          ))}
        </div>
      ) : null}
      {/* Both 指示牌 mounts — the hung board and the wall board — are composed on the
          same board editor, so the tile follows the piece and not one palette id. */}
      {piece !== null && isSignType(piece) ? (
        <Block
          label={t('customise')}
          icon="board"
          onClick={() => st().openSignComposer()}
        />
      ) : null}
    </>
  )
}

function BuilderAttributeTile({ attribute, moduleType, state }: { attribute: BuilderAttribute; moduleType: string; state: AppState }): React.ReactElement {
  if (attribute.kind === 'rotation') return <RotateTile rotation={state.moduleRot} label={translate(attribute.label)} onClick={attribute.activate} />
  if (attribute.visual === 'grid-position') {
    const position = moduleType.startsWith('pillar-slim') ? state.moduleRot : state.lightPosition
    return <PositionTile position={position} shortcut={attribute.shortcut} onClick={attribute.activate} />
  }
  const dimension = dimensionSelection(attribute.kind, moduleType, state)
  const art = attribute.kind === 'span' ? <StoreyArt span={state.escalatorSpan} />
    : attribute.kind === 'size' ? <LiftSizeArt size={state.liftSize} />
    : dimension ? <DimensionArt vertical={attribute.kind === 'height' || (attribute.kind === 'length' && (moduleType.startsWith('pillar') || moduleType === 'lift'))} {...dimension} align={dimensionMarkAlign(attribute.kind)} />
    : attribute.kind === 'direction' ? <DirectionArt direction={moduleType === 'road' ? state.roadDirection : state.escalatorDir} />
    : attribute.visual === 'roof-snap' ? (state.roofPlateSnap === 'lower' ? <LuArrowDownToLine /> : <LuArrowUpToLine />)
    : undefined
  const icon = attribute.kind === 'style' ? (moduleType === 'gate' || moduleType === 'gate-new' ? 'turnstile' : 'block') : undefined
  return <Block label={translate(attribute.label)} art={art} icon={icon} shortcut={attribute.shortcut} onClick={attribute.activate} />
}
