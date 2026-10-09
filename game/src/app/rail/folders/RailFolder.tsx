// The 结构 folder: six block/rail/cut tiles, the two roof/pillar families,
// then tunnel and bridge. Each tool keeps its own inline controls.

import { StructurePanel } from '../menus/StructurePanel.tsx'
import { CUT_MODES, cutAnchor, useStore } from '../../store.ts'
import { railSummary } from '../../../build/rail.ts'
import { trackRunLengthLabel } from '../../../sim/track.ts'
import { armedActionsAnchor, armedCut, findSelectedTrack, PLATFORM_TILE, TUNNEL_TILE } from '../helpers.ts'
import type { SubMenuKey } from '../helpers.ts'
import { ActionRow } from '../actions/ActionRow.tsx'
import { Block } from '../shared/Block.tsx'
import { RotateTile } from '../shared/RotateTile.tsx'
import { InlineExpand, InlinePanel, interleaveRows } from '../shared/InlinePanel.tsx'
import { TileGrid } from '../shared/TileGrid.tsx'
import { LineItem } from '../items/LineItem.tsx'

export function RailFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (key: SubMenuKey) => void }): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const bridgeOpen = tool === 'module' && moduleType === 'bridge'
  const setTool = useStore((s) => s.setTool)
  const selected = useStore((s) => s.selected)
  const stationModules = useStore((s) => s.station.modules)
  const stationLines = useStore((s) => s.station.lines)
  const railDir = useStore((s) => s.railDir)
  const railLineId = useStore((s) => s.railLineId)
  const railRot = useStore((s) => s.railRot)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const autoWalls = useStore((s) => s.autoWalls)
  const cut = useStore(armedCut)
  const pieceAnchor = useStore(armedActionsAnchor)
  const st = useStore.getState

  // The 结构 folder is also the rail panel. When a rail is selected it edits that
  // rail; otherwise it sets the defaults the next placement will use.
  const track = findSelectedTrack(selected, stationModules)
  const railDirNow = track ? (track.cfg.dir ?? 'up') : railDir
  const railLineNow = track ? track.cfg.line : railLineId || stationLines[0]?.id || ''
  const trackSummary = track ? railSummary(track, stationLines.find((l) => l.id === track.cfg.line)) : null
  // The platform-only controls (方向 / 线路) make no sense for a
  // tunnel, so they are shown only while placing or editing a platform run.
  const editingTunnel = track ? !!(track.cfg.tunnel || track.cfg.bridge) : tool === 'tunnel'
  // Inline derived rows, same style as 设备 / 装饰: the platform row folds out
  // below 站台 while placing or editing a platform, the tunnel row below 隧道
  // while placing a tunnel. Clicking away closes both with the same shrink.
  const platformOpen = !bridgeOpen && (tool === 'rail' || (track !== undefined && !track.cfg.tunnel && !track.cfg.bridge))
  const tunnelOpen = tool === 'tunnel'
  const setRailDirNow = (d: 'up' | 'down'): void => {
    if (track) st().updateRail(track.id, { dir: d })
    else st().setRailDir(d)
  }
  const setRailLineNow = (id: string): void => {
    if (track) st().updateRail(track.id, { line: id })
    else st().setRailLine(id)
  }

  return (
    <>
      <div className="blockGrid">
        {interleaveRows(
          [
            {
              anchor: 'block',
              node: <Block key="block" label="方块" icon="block" shortcut="F" tile="block" active={tool === 'block' && cut === null} onClick={() => { setTool('block'); if (cut !== null) st().setCutMode(null) }} />,
            },
            {
              anchor: '__platform',
              node: (
                <Block
                  key="__platform"
                  label="站台"
                  icon="rail"
                  tile={PLATFORM_TILE}
                  active={tool === 'rail'}
                  shortcut="L"
                  submenu={platformOpen}
                  onClick={() => setTool('rail')}
                />
              ),
            },
            { anchor: 'wall', node: <Block key="wall" label="墙" icon="wall" shortcut="G" tile="wall" active={tool === 'wall'} onClick={() => setTool('wall')} /> },
            ...CUT_MODES.map((c) => ({
              anchor: cutAnchor(c.id),
              node: <Block key={cutAnchor(c.id)} label={c.label} icon={c.icon} tile={cutAnchor(c.id)} active={tool === 'block' && cut === c.id} onClick={() => { setTool('block'); st().setCutMode(c.id) }} />,
            })),
          ],
          (anchor) => {
            if (anchor === 'block') return [
              <InlineExpand key="auto-walls" open={tool === 'block' && cut === null}>
                <Block label="生成墙壁" icon="wall" shortcut="Tab" active={autoWalls} onClick={() => st().setAutoWalls(!autoWalls)} />
              </InlineExpand>,
            ]
            if (anchor.startsWith('__cut-')) return [
              <ActionRow key={`actions-${anchor}`} anchor={anchor} pieceAnchor={pieceAnchor} openFamily={null} />,
            ]
            if (anchor === '__platform') {
              return [
                <InlinePanel key="platform-derived" open={platformOpen}>
                  {(tool !== 'tunnel' || !editingTunnel) && (
                    <div className="blockGrid">
                      {tool !== 'tunnel' && (
                        <RotateTile label={`旋转 ${((4 - railRot) % 4) * 90}°`} onClick={() => st().rotateRail()} />
                      )}
                    </div>
                  )}
                  {!editingTunnel && (
                    <>
                      <div className="bpSub">
                        <div className="bpSubTitle">方向</div>
                        <div className="blockGrid two">
                          <Block label="上行" icon="up" shortcut="Tab" active={railDirNow === 'up'} onClick={() => setRailDirNow('up')} />
                          <Block label="下行" icon="down" shortcut="Tab" active={railDirNow === 'down'} onClick={() => setRailDirNow('down')} />
                        </div>
                      </div>
                      <div className="bpSub">
                        <div className="bpSubTitle">线路</div>
                        <div className="blockGrid">
                          {stationLines.map((l) => (
                            <LineItem
                              key={l.id}
                              lineId={l.id}
                              colour={l.colour}
                              active={railLineNow === l.id}
                              onSelect={() => setRailLineNow(l.id)}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </InlinePanel>,
              ]
            }
            return []
          },
        )}
        <TileGrid folder="rail" subMenu={subMenu} onToggleSubMenu={onToggleSubMenu} embedded />
        {interleaveRows([
          { anchor: '__tunnel', node: <Block key="__tunnel" label="隧道" icon="tunnel" tile={TUNNEL_TILE} active={tool === 'tunnel'} submenu={tunnelOpen} onClick={() => setTool('tunnel')} /> },
          { anchor: 'bridge', node: <Block key="bridge" label="轨道桥" icon="bridge" tile="bridge" active={bridgeOpen} submenu={bridgeOpen} onClick={() => { setModuleType('bridge'); setTool('module') }} /> },
        ], (anchor) => anchor === '__tunnel' ? [
          <InlinePanel key="tunnel-derived" open={tunnelOpen}>
            <div className="blockGrid"><Block label={trackRunLengthLabel(tunnelLength)} icon="ortho" shortcut="Tab" onClick={() => st().cycleTunnelLength()} /></div>
          </InlinePanel>,
        ] : [<StructurePanel key="bridge-derived" anchor="bridge" />])}
      </div>
      {track && (
        <div className="muted small railStatus">
          {`已选${track.cfg.bridge ? '轨道桥' : track.cfg.tunnel ? '隧道' : '轨道'} · ${track.w} m × ${track.d ?? 1} m${trackSummary && !track.cfg.tunnel && !track.cfg.bridge ? ` · ${trackSummary.cars} 节 ${trackSummary.trainLength} m · ${trackSummary.doors} 门` : ''}`}
        </div>
      )}
    </>
  )
}
