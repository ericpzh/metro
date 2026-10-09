// The rail slice: the 站台/隧道 tools' bound line, direction, rotation and
// tunnel length, and every rail edit — laying, extending, re-deriving screen
// doors and removing (§7).

import type { StateCreator } from 'zustand'
import { removeModule } from '../../../build/model.ts'
import {
  defaultLine,
  dropDerivedEdges,
  makeTrack,
  placeTrack,
  placeTunnel,
  regenerateRailEdges,
  stripTunnelShell,
  trackBlockReason,
  trackPieceForLine,
} from '../../../build/rail.ts'
import { nextTrackRunLength, supportedTrackRunLength, trackOriginForCentre } from '../../../sim/track.ts'
import type { BridgeRailing, LineDirection } from '../../../sim/types.ts'
import type { AppState } from '../Store.ts'

export interface RailSlice {
  /** Rail tool: the line/direction a freshly laid bed binds to. Power is a
   *  line option (edited in the RHS 线路 panel), so it is not stored here. */
  railLineId: string
  railDir: LineDirection
  /** Quarter-turn applied to the rail piece being placed (R): 0..3. */
  railRot: number
  /** Tunnel tool: how far the auto-extended run reaches, in metres. */
  tunnelLength: number

  setRailLine: (id: string) => void
  setRailDir: (dir: LineDirection) => void
  /** Turn the rail piece being placed 90° (R). */
  rotateRail: () => void
  /** Toggle the platform run's 上行/下行 (Tab): edits a selected platform, else the tool default. */
  cycleRailDir: () => void
  /** Place the fixed track piece for the bound line at a cell (dig + doors). */
  layTrack: (at: [number, number, number]) => void
  /** Set the tunnel run length in metres. */
  setTunnelLength: (metres: number) => void
  cycleTunnelLength: () => void
  /** Extend an existing rail with a tunnel run (dig + track module, no doors). */
  layTunnel: (sourceId: string, at?: readonly [number, number, number]) => void
  /** Re-derive a rail's screen doors after the platform floor changed. */
  regenRail: (trackId: string) => void
  /** Remove a rail and the screen doors derived from it. */
  removeRail: (trackId: string) => void
  /** Edit a rail's line/direction and re-derive its screen doors. */
  updateRail: (trackId: string, patch: { line?: string; dir?: LineDirection; bridgeRailing?: BridgeRailing }) => void
}

export const createRailSlice: StateCreator<AppState, [], [], RailSlice> = (set, get) => ({
  railLineId: '',
  railDir: 'up',
  railRot: 0,
  tunnelLength: 32,

  setRailLine: (id) => set({ railLineId: id }),
  setRailDir: (dir) => set({ railDir: dir }),
  rotateRail: () => set((s) => ({ railRot: (s.railRot + 3) % 4 })),
  cycleRailDir: () => {
    const st = get()
    const sel = st.selected
    const track = sel?.kind === 'module' ? st.station.modules.find((m) => m.id === sel.key) : undefined
    if (track && track.type === 'track' && !track.cfg.tunnel) {
      get().updateRail(track.id, { dir: (track.cfg.dir ?? 'up') === 'up' ? 'down' : 'up' })
      return
    }
    set({ railDir: st.railDir === 'up' ? 'down' : 'up' })
  },
  layTrack: (at) => {
    const st = get()
    let station = st.station
    let lineId = st.railLineId
    if (!station.lines.some((l) => l.id === lineId)) {
      // First rail on a fresh station: create the line it binds to, so placement
      // never stalls on an empty line list.
      if (station.lines.length === 0) {
        const line = defaultLine('1', st.railDir, 'third-rail')
        station = { ...station, lines: [line] }
        lineId = line.id
      } else {
        lineId = station.lines[0].id
      }
      set({ railLineId: lineId })
    }
    const line = station.lines.find((l) => l.id === lineId)
    if (!line) return
    // The piece is sized from the line's consist before it is placed: a
    // car-width bed and a run the length of the whole train. Power is a line
    // option, so the track inherits the bound line's power.
    const { w, d } = trackPieceForLine(line)
    const [ox, oy] = trackOriginForCentre(st.railRot, at[0], at[1], w, d)
    // Eligibility: nothing may share the space, a platform must lie on solid
    // floor (the bed is a full three cells wide) and may not cross a wall.
    const candidate = makeTrack({ id: 'probe', lineId, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: at[2], w, d })
    const block = trackBlockReason(station, candidate)
    if (block) {
      set({
        notice:
          block === 'interference'
            ? '这儿有设备、房间、站台或别的轨道挡着，放不下'
            : block === 'wall'
              ? '轨道中间有墙，站台放不下；这里可以用隧道穿过'
              : '站台轨道要铺在整片地面上（至少三格宽）',
      })
      return
    }
    const next = placeTrack(station, { lineId, dir: st.railDir, power: line.power, rot: st.railRot, x: ox, y: oy, z: at[2], w, d })
    if (next === station) {
      set({ notice: '这里已经有轨道了' })
      return
    }
    get().commit(next)
    const track = [...next.modules].reverse().find((m) => m.type === 'track')
    const derived = track ? next.modules.filter((m) => m.type === 'platform-edge' && m.cfg.from === track.id).length : 0
    set({ notice: derived > 0 ? `轨道已铺设（${w} m），自动生成 ${derived} 段站台门` : `轨道已铺设（${w} m）；旁边没有站台，站台门暂未生成` })
  },
  setTunnelLength: (metres) => set({ tunnelLength: supportedTrackRunLength(metres) }),
  cycleTunnelLength: () => set((s) => ({ tunnelLength: nextTrackRunLength(s.tunnelLength) })),
  layTunnel: (sourceId, at) => {
    const st = get()
    const next = placeTunnel(st.station, sourceId, st.tunnelLength, at)
    if (next === st.station) {
      set({ notice: '隧道接不上去：这里被设备、房间、站台或别的轨道挡住了' })
      return
    }
    get().commit(next)
    set({ notice: `隧道已接通（${st.tunnelLength} m）` })
  },
  regenRail: (trackId) => {
    const next = regenerateRailEdges(get().station, trackId)
    get().commit(next)
    set({ notice: '站台门已按当前站台重新生成' })
  },
  removeRail: (trackId) => {
    const cleaned = dropDerivedEdges(get().station, trackId)
    // A tunnel takes the shell it raised with it; a platform has none.
    const without = stripTunnelShell(removeModule(cleaned, trackId), trackId)
    get().commit(without)
    set({ notice: '轨道已拆除' })
  },
  updateRail: (trackId, patch) => {
    const st = get()
    const modules = st.station.modules.map((m) =>
      m.id === trackId && m.type === 'track' ? { ...m, cfg: { ...m.cfg, ...patch } } : m,
    )
    const edited = { ...st.station, modules }
    get().commit(regenerateRailEdges(edited, trackId))
  },
})
