// The 视图 folder body (§8 view toggles).
//
// Layer visibility and overlays: 显示其他层 / 隐藏天花板 / 剖切 / 隐藏墙壁 /
// 热力图 / 分区图, plus **隐藏UI** — the one tile that hides drawing furniture
// rather than station: the 1 m editing lattice and its cell cursor
// (`render/scene/systems/GridSystem.ts`). It takes nothing off the interface and
// nothing off the station, so the rail, the panels and the tools all stay.

import { useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

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
      <Block
        label="显示其他层"
        icon="ghost"
        shortcut="X"
        active={ghost}
        onClick={() => st().setGhostOther(!ghost)}
      />
      <Block
        label="隐藏天花板"
        icon="ceiling"
        shortcut="H"
        active={autoCeiling}
        onClick={() => st().setAutoCeiling(!autoCeiling)}
      />
      <Block label="剖切" icon="cutaway" shortcut="C" active={cutaway} onClick={() => st().setCutaway(!cutaway)} />
      <Block label="隐藏墙壁" icon="wall" active={hideWalls} onClick={() => st().setHideWalls(!hideWalls)} />
      <Block label="热力图" icon="heat" active={overlayOn} onClick={() => st().setOverlay(!overlayOn)} />
      <Block label="分区图" icon="zoneHeat" active={zoneOverlayOn} onClick={() => st().setZoneOverlay(!zoneOverlayOn)} />
      <Block label="隐藏UI" icon="gridOff" shortcut="U" active={hideUI} onClick={() => st().setHideUI(!hideUI)} />
    </div>
  )
}
