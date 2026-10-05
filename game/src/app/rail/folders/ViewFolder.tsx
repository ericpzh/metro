// The 视图 folder body (§8 view toggles).
//
// Layer visibility and overlays: 显示其他层 / 隐藏天花板 / 剖切 / 隐藏墙壁 /
// 热力图 / 分区图. Plain toggles — no sub-menus, no thumbnails.

import { useStore } from '../../store.ts'
import { Block } from '../shared/Block.tsx'

export function ViewFolder(): React.ReactElement {
  const ghost = useStore((s) => s.ghostOtherLevels)
  const autoCeiling = useStore((s) => s.autoCeiling)
  const cutaway = useStore((s) => s.cutaway)
  const hideWalls = useStore((s) => s.hideWalls)
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
    </div>
  )
}
