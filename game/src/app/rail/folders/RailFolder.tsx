// The 轨道 folder body (§7 rail building).
//
// 站台 / 隧道, each with its inline derived row: the platform row (旋转 /
// 重置屏蔽门 / 方向 / 线路) folds out below 站台 while placing or editing a
// platform, the tunnel row (length slider) below 隧道 while placing a tunnel.
// When a rail is selected the folder edits that rail; otherwise it sets the
// defaults the next placement will use.

import { useStore } from '../../store.ts'
import { railSummary } from '../../../build/rail.ts'
import { findSelectedTrack } from '../helpers.ts'
import { Block } from '../shared/Block.tsx'
import { InlinePanel, interleaveRows } from '../shared/InlinePanel.tsx'
import { LineItem } from '../items/LineItem.tsx'

export function RailFolder(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const selected = useStore((s) => s.selected)
  const stationModules = useStore((s) => s.station.modules)
  const stationLines = useStore((s) => s.station.lines)
  const railDir = useStore((s) => s.railDir)
  const railLineId = useStore((s) => s.railLineId)
  const railRot = useStore((s) => s.railRot)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const st = useStore.getState

  // The 轨道 folder is the rail panel. When a rail is selected it edits that
  // rail; otherwise it sets the defaults the next placement will use.
  const track = findSelectedTrack(selected, stationModules)
  const railDirNow = track ? (track.cfg.dir ?? 'up') : railDir
  const railLineNow = track ? track.cfg.line : railLineId || stationLines[0]?.id || ''
  const trackSummary = track ? railSummary(track, stationLines.find((l) => l.id === track.cfg.line)) : null
  // The platform-only controls (方向 / 线路 / 重置屏蔽门) make no sense for a
  // tunnel, so they are shown only while placing or editing a platform run.
  const editingTunnel = track ? !!track.cfg.tunnel : tool === 'tunnel'
  // Inline derived rows, same style as 设备 / 装饰: the platform row folds out
  // below 站台 while placing or editing a platform, the tunnel row below 隧道
  // while placing a tunnel. Clicking away closes both with the same shrink.
  const platformOpen = tool === 'rail' || (track !== undefined && !track.cfg.tunnel)
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
              anchor: '__platform',
              node: (
                <Block
                  key="__platform"
                  label="站台"
                  icon="rail"
                  active={tool === 'rail'}
                  shortcut="L"
                  submenu={platformOpen}
                  onClick={() => setTool('rail')}
                />
              ),
            },
            {
              anchor: '__tunnel',
              node: (
                <Block
                  key="__tunnel"
                  label="隧道"
                  icon="tunnel"
                  active={tool === 'tunnel'}
                  submenu={tunnelOpen}
                  onClick={() => setTool('tunnel')}
                />
              ),
            },
          ],
          (anchor) => {
            if (anchor === '__platform') {
              return [
                <InlinePanel key="platform-derived" open={platformOpen}>
                  {(tool !== 'tunnel' || !editingTunnel) && (
                    <div className="blockGrid">
                      {tool !== 'tunnel' && (
                        <Block
                          label={`旋转 ${((4 - railRot) % 4) * 90}°`}
                          icon="redo"
                          shortcut="R"
                          onClick={() => st().rotateRail()}
                        />
                      )}
                      {!editingTunnel && (
                        <Block
                          label="重置屏蔽门"
                          icon="refresh"
                          onClick={() => st().refreshRailDoors()}
                        />
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
            if (anchor === '__tunnel') {
              return [
                <InlinePanel key="tunnel-derived" open={tunnelOpen}>
                  <div className="bpSub">
                    <div className="bpSubTitle">隧道长度 {tunnelLength} m</div>
                    <input
                      type="range"
                      min={5}
                      max={200}
                      step={1}
                      value={tunnelLength}
                      onChange={(e) => st().setTunnelLength(Number(e.target.value))}
                    />
                  </div>
                </InlinePanel>,
              ]
            }
            return []
          },
        )}
      </div>
      {track && (
        <div className="muted small railStatus">
          {`已选${track.cfg.tunnel ? '隧道' : '轨道'} · ${track.w} m × ${track.d ?? 1} m${trackSummary && !track.cfg.tunnel ? ` · ${trackSummary.cars} 节 ${trackSummary.trainLength} m · ${trackSummary.doors} 门` : ''}`}
        </div>
      )}
    </>
  )
}
