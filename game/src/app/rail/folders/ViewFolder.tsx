// The 视图 folder body (§8 view toggles) — the 信息栏's second row, folded by **Alt+W**
// between 信息 and 出入口 (`windows/inspector/Inspector.tsx`), because these are controls
// over what the station *looks like* rather than pieces of it.
//
// **The grid is three wide**, not two: the inspector is the wider column (`.main` gives
// the build rail 232px and the panel 300px), so `styles.css`'s `.panel .blockGrid` rule —
// which this body and the 剖切 row it folds out both inherit — lays the seven tiles out
// three to a row (显示其他层 / 剖切 / 隐藏天花板, 隐藏墙壁 / 热力图 / 分区图, 隐藏UI).
//
// **The tile order is the menu order**, one row of the grid at a time, nearest
// the tool the player is likely to want next: the two `X` / `C` slice toggles
// first (显示其他层, 剖切), then the 隐藏 pair that takes station furniture away
// (隐藏天花板, 隐藏墙壁), then the overlays that paint the station rather than
// hide it (热力图, 分区图), and last 隐藏UI (**U**, the station drawn whole, and
// the 1 m editing lattice and its cell cursor gone with the ghost sheet —
// `render/levelSlicing.ts`, `render/scene/systems/GridSystem.ts`).
//
// 剖切 has exactly one control besides its toggle — **旋转**, one quarter turn a
// press — and it folds out in the sub-menu row a folder already has for a tool's own
// settings (`InlineExpand`), **at the foot of the row 剖切 sits in** rather than right
// after the tile itself: a full-width row is inserted between grid rows, so at three
// tiles a row that means after 隐藏天花板 (see the note on `<CutControls>` below).
// Everything else the cut used to
// carry (a position slider and its box, 方位角, 倾角, the readout, the hint and
// the 复位 / 翻转 pair) is gone: the surface is dragged in the viewport
// (`app/Viewport.tsx`), so the menu only has to answer for the one thing a
// pointer cannot say, which way the cut looks.

import { useStore } from '../../store.ts'
import { nextAzimuth } from '../../../render/section.ts'
import { Block } from '../shared/Block.tsx'
import { RotateTile } from '../shared/RotateTile.tsx'
import { InlineExpand } from '../shared/InlinePanel.tsx'

export function ViewFolder(): React.ReactElement {
  const ghost = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const hideWalls = useStore((s) => s.hideWalls)
  const hideUI = useStore((s) => s.hideUI)
  const overlayOn = useStore((s) => s.overlayOn)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const st = useStore.getState
  return (
    <div className="blockGrid">
      {/* Both slice toggles are shown but plainly out of play while 隐藏UI is on —
          it draws every storey with no ceiling lifted — so the rule is
          discoverable. */}
      <Block
        label="显示其他层"
        icon="ghost"
        shortcut="X"
        active={ghost}
        disabled={hideUI}
        onClick={() => st().setGhostOther(!ghost)}
      />
      <Block label="剖切" icon="cutaway" shortcut="C" active={cutaway} onClick={() => st().setCutaway(!cutaway)} />
      <Block
        label="隐藏天花板"
        icon="ceiling"
        shortcut="H"
        active={autoCeiling}
        disabled={hideUI}
        onClick={() => st().setAutoCeiling(!autoCeiling)}
      />
      {/* 剖切's own row, **after the whole row that holds it**: a full-width row can only
          be inserted between grid rows (`InlineExpand` spans `grid-column: 1 / -1`), so
          placed any earlier it would break the row after two tiles and leave the third
          cell of the first row empty. */}
      <CutControls open={cutaway} />
      <Block label="隐藏墙壁" icon="wall" active={hideWalls} onClick={() => st().setHideWalls(!hideWalls)} />
      <Block label="热力图" icon="heat" active={overlayOn} onClick={() => st().setOverlay(!overlayOn)} />
      <Block label="分区图" icon="zoneHeat" active={zoneOverlayOn} onClick={() => st().setZoneOverlay(!zoneOverlayOn)} />
      <Block label="隐藏UI" icon="gridOff" shortcut="U" active={hideUI} onClick={() => st().setHideUI(!hideUI)} />
    </div>
  )
}

/**
 * The cut's own two controls, folded out under the 剖切 tile while the cut is on:
 * **旋转 X°** and **隐藏剖切面**.
 *
 * 旋转 reads the angle it will turn *to*, so the tile says what a press does
 * rather than what the cut was (`render/section.ts` `nextAzimuth`). 隐藏剖切面
 * keeps the cut but takes the surface's drawing away — sheet, border, grid, grab
 * handle and the direction arrow — so the player can look at the slice itself with
 * nothing of the tool over it. It reads as the state it is in, like every other
 * 隐藏 tile in the folder.
 */
function CutControls({ open }: { open: boolean }): React.ReactElement {
  const azimuth = useStore((s) => s.section.orientation.azimuth)
  const rotateSection = useStore((s) => s.rotateSection)
  const hideSurface = useStore((s) => s.hideSectionSurface)
  const setHideSectionSurface = useStore((s) => s.setHideSectionSurface)
  const next = nextAzimuth(azimuth)
  return (
    <InlineExpand open={open}>
      <RotateTile label={`旋转 ${next}°`} onClick={rotateSection} />
      <Block
        label="隐藏剖切面"
        icon="cutSurface"
        shortcut="Y"
        active={hideSurface}
        onClick={() => setHideSectionSurface(!hideSurface)}
      />
    </InlineExpand>
  )
}
