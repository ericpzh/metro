import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The 结构 folder: six block/rail/cut tiles, the two roof/pillar families,
// then tunnel and bridge. Each tool keeps its own inline controls.

import { StructurePanel } from '../menus/StructurePanel.tsx'
import { CUT_MODES, cutAnchor, useStore } from '../../store.ts'
import { railSummary } from '../../../build/rail.ts'
import { TRACK_RUN_LENGTHS, trackRunLengthLabel } from '../../../sim/track.ts'
import { armedActionsAnchor, armedCut, findSelectedTrack, PLATFORM_TILE, TUNNEL_TILE } from '../helpers.ts'
import type { SubMenuKey } from '../helpers.ts'
import { ActionRow } from '../actions/ActionRow.tsx'
import { Block } from '../shared/Block.tsx'
import { DimensionArt, DirectionArt } from '../shared/AttributeArt.tsx'
import { RotateTile } from '../shared/RotateTile.tsx'
import { InlineExpand, InlinePanel, interleaveRows } from '../shared/InlinePanel.tsx'
import { TileGrid } from '../shared/TileGrid.tsx'
import { LineItem } from '../items/LineItem.tsx'

export function RailFolder({ subMenu, onToggleSubMenu }: { subMenu: SubMenuKey | null; onToggleSubMenu: (key: SubMenuKey) => void }): React.ReactElement {
  useLanguage()
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
  const railCatenaryDefault = useStore((s) => s.railCatenaryStyle)
  const railRot = useStore((s) => s.railRot)
  const tunnelLength = useStore((s) => s.tunnelLength)
  const autoWalls = useStore((s) => s.autoWalls)
  const suspendedCeiling = useStore((s) => s.suspendedCeiling)
  const cut = useStore(armedCut)
  const pieceAnchor = useStore(armedActionsAnchor)
  const st = useStore.getState

  // The 结构 folder is also the rail panel. When a rail is selected it edits that
  // rail; otherwise it sets the defaults the next placement will use.
  const track = findSelectedTrack(selected, stationModules)
  const railDirNow = track ? (track.cfg.dir ?? 'up') : railDir
  const railLineNow = track ? track.cfg.line : railLineId || stationLines[0]?.id || ''
  const railLine = stationLines.find((l) => l.id === railLineNow)
  const catenaryStyle = track?.cfg.catenaryStyle ?? railCatenaryDefault
  const showCatenaryStyle = railLine?.power === 'catenary' && (railLine.psd === 'half' || railLine.psd === 'none')
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
  const toggleCatenaryStyle = (): void => {
    const next = catenaryStyle === 'canopy' ? 'gantry' : 'canopy'
    if (track) st().updateRail(track.id, { catenaryStyle: next })
    else st().setRailCatenaryStyle(next)
  }

  return (
    <>
      <div className="blockGrid">
        {interleaveRows(
          [
            {
              anchor: 'block',
              node: <Block key="block" label={t('block')} icon="block" shortcut="F" tile="block" active={tool === 'block' && cut === null} onClick={() => { setTool('block'); if (cut !== null) st().setCutMode(null) }} />,
            },
            {
              anchor: '__platform',
              node: (
                <Block
                  key="__platform"
                  label={t('platform')}
                  icon="rail"
                  tile={PLATFORM_TILE}
                  active={tool === 'rail'}
                  shortcut="L"
                  submenu={platformOpen}
                  onClick={() => setTool('rail')}
                />
              ),
            },
            { anchor: 'wall', node: <Block key="wall" label={t('wall')} icon="wall" shortcut="G" tile="wall" active={tool === 'wall'} onClick={() => setTool('wall')} /> },
            ...CUT_MODES.map((c) => ({
              anchor: cutAnchor(c.id),
              node: <Block key={cutAnchor(c.id)} label={translate(c.label)} icon={c.icon} tile={cutAnchor(c.id)} active={tool === 'block' && cut === c.id} onClick={() => { setTool('block'); st().setCutMode(c.id) }} />,
            })),
          ],
          (anchor) => {
            if (anchor === 'block') return [
              <InlineExpand key="auto-walls" open={tool === 'block' && cut === null}>
                <Block label={suspendedCeiling ? t('block') : t('suspended_ceiling')} icon="block" shortcut="Tab" active={suspendedCeiling} onClick={() => st().setSuspendedCeiling(!suspendedCeiling)} />
                {!suspendedCeiling && <Block label={t('generate_walls')} icon="wall" shortcut="Shift+Tab" active={autoWalls} onClick={() => st().setAutoWalls(!autoWalls)} />}
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
                        <RotateTile rotation={railRot} label={t('rotate_value', ((4 - railRot) % 4) * 90)} onClick={() => st().rotateRail()} />
                      )}
                      {!editingTunnel && <Block label={t(railDirNow)} art={<DirectionArt direction={railDirNow} />} shortcut="Tab" onClick={() => setRailDirNow(railDirNow === 'up' ? 'down' : 'up')} />}
                      {showCatenaryStyle && (
                        <Block
                          label={t('catenary_style_value', t(catenaryStyle === 'gantry' ? 'catenary_gantry' : 'catenary_canopy'))}
                          icon={catenaryStyle === 'gantry' ? 'bridge' : 'roof'}
                          active={catenaryStyle === 'gantry'}
                          onClick={toggleCatenaryStyle}
                        />
                      )}
                    </div>
                  )}
                  {!editingTunnel && (
                    <>
                      <div className="bpSub">
                        <div className="bpSubTitle">{t('line')}</div>
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
          { anchor: '__tunnel', node: <Block key="__tunnel" label={t('tunnel')} icon="tunnel" tile={TUNNEL_TILE} active={tool === 'tunnel'} submenu={tunnelOpen} onClick={() => setTool('tunnel')} /> },
          { anchor: 'bridge', node: <Block key="bridge" label={t('railway_bridge')} icon="bridge" tile="bridge" active={bridgeOpen} submenu={bridgeOpen} onClick={() => { setModuleType('bridge'); setTool('module') }} /> },
        ], (anchor) => anchor === '__tunnel' ? [
          <InlinePanel key="tunnel-derived" open={tunnelOpen}>
            <div className="blockGrid"><Block label={translate(trackRunLengthLabel(tunnelLength))} art={<DimensionArt selected={TRACK_RUN_LENGTHS.indexOf(tunnelLength as typeof TRACK_RUN_LENGTHS[number])} count={TRACK_RUN_LENGTHS.length} />} shortcut="Tab" onClick={() => st().cycleTunnelLength()} /></div>
          </InlinePanel>,
        ] : [<StructurePanel key="bridge-derived" anchor="bridge" />])}
      </div>
      {track && (
        <div className="muted small railStatus">
          {t('selected_value_value_m_value_mvalue', track.cfg.bridge ? t('railway_bridge') : track.cfg.tunnel ? t('tunnel') : t('track'), track.w, track.d ?? 1, trackSummary && !track.cfg.tunnel && !track.cfg.bridge ? t('value_cars_value_m_value_doors', trackSummary.cars, trackSummary.trainLength, trackSummary.doors) : '')}
        </div>
      )}
    </>
  )
}
