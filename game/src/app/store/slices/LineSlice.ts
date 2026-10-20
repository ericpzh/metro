import { msg } from '../../../sim/i18n.ts'
// The line slice: the 线路 panel's edits to shared line parameters. A line owns
// its rolling stock and its tracks' sizing, so consist, power and 屏蔽门 edits
// fan out to every bound rail (§7).

import type { StateCreator } from 'zustand'
import {
  defaultLine,
  regenerateRailEdges,
  removeLineAndTracks,
  resizeTrack,
  setLinePower,
  trackPieceForLine,
} from '../../../build/rail.ts'
import { normalizeHeadwayProfile, snapFormation } from '../../../sim/headway.ts'
import type { LineDef } from '../../../sim/types.ts'
import type { AppState } from '../Store.ts'

export interface LineSlice {
  /** Add a new line and make it the rail tool's target. */
  addLine: () => void
  /** Delete a line and every track bound to it (undoable). */
  removeLine: (lineId: string) => void
  /** Edit a line's shared parameters (stock, cars, headway, colour). */
  updateLine: (lineId: string, patch: Partial<LineDef>) => void
}

export const createLineSlice: StateCreator<AppState, [], [], LineSlice> = (set, get) => ({
  addLine: () => {
    const st = get()
    const used = new Set(st.station.lines.map((l) => l.id))
    let n = st.station.lines.length + 1
    while (used.has(String(n))) n++
    const id = String(n)
    const line = defaultLine(id, st.railDir, 'third-rail', st.station.storeyHeight)
    get().commit({ ...st.station, lines: [...st.station.lines, line] })
    set({ railLineId: id, notice: msg('created_value_new_track_will_bind_automatically', line.name) })
  },
  removeLine: (lineId) => {
    const st = get()
    const line = st.station.lines.find((l) => l.id === lineId)
    if (!line) return
    // A line owns its rolling stock, so the pure edit drops every track bound to
    // it along with those tracks' derived screen doors and tunnel shell.
    const trackIds = st.station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId).map((m) => m.id)
    const station = removeLineAndTracks(st.station, lineId)
    const lines = station.lines
    // A line owns the rail tool's target and any selection of one of its tracks,
    // so repoint both at whatever line survives.
    const railLineId = st.railLineId === lineId ? (lines[0]?.id ?? '') : st.railLineId
    const selected = st.selected?.kind === 'module' && trackIds.includes(st.selected.key) ? null : st.selected
    get().commit(station)
    set({
      railLineId,
      selected,
      notice: msg('deleted_line_valuevalue', line.name, trackIds.length > 0 ? msg('including_value_track_sections', trackIds.length) : ''),
    })
  },
  updateLine: (lineId, patch) => {
    const st = get()
    const prev = st.station.lines.find((l) => l.id === lineId)
    // Consist is one of the fixed menu entries in `sim/headway.ts`; snap so a bad
    // save or a stale caller cannot produce a one- or five-car train.
    let fixed = patch.cars !== undefined ? { ...patch, cars: snapFormation(patch.cars) } : patch
    // A headway edit clamps leg by leg (60–1200 s), keeping the legs the patch
    // did not touch — the panel only ever sends peak/offpeak.
    if (patch.headwayProfile !== undefined) {
      fixed = {
        ...fixed,
        headwayProfile: normalizeHeadwayProfile(patch.headwayProfile, prev?.headwayProfile),
      }
    }
    // The load slider is per car, so a 编组 change keeps that per-car value and
    // scales the stored whole-train total with the new car count. A patch that
    // sets the total itself (the slider) is left alone.
    if (patch.cars !== undefined && patch.alightPerTrain === undefined && prev) {
      const cars = snapFormation(patch.cars)
      fixed = { ...fixed, alightPerTrain: Math.round((prev.alightPerTrain / prev.cars) * cars) }
    }
    const lines = st.station.lines.map((l) => (l.id === lineId ? { ...l, ...fixed } : l))
    let station = { ...st.station, lines }
    // Power is a line option, so carry it to every track bound to the line —
    // platform rails and tunnel runs both — and their models re-cut on rebuild.
    if (patch.power !== undefined) station = setLinePower(station, lineId, patch.power)
    // A 屏蔽门 全高/半高 switch reads off each derived edge's own `cfg.psd`, so
    // re-derive every rail on the line to move its screens with the line.
    if (patch.psd !== undefined) {
      const ids = station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId).map((m) => m.id)
      for (const id of ids) station = regenerateRailEdges(station, id, true)
    }
    // A platform rail is sized from its line's consist, so a stock/cars edit
    // re-cuts it to the new run length. Every track type shares the consist's
    // required cross-section, while tunnels and bridges keep their authored run
    // length; tunnel shells and bridge piers are rebuilt around the wider bed.
    if (patch.stock !== undefined || patch.cars !== undefined) {
      const line = lines.find((l) => l.id === lineId)
      if (line) {
        const { w, d } = trackPieceForLine(line)
        const ids = station.modules.filter((m) => m.type === 'track' && m.cfg.line === lineId).map((m) => m.id)
        for (const id of ids) {
          const track = station.modules.find((m) => m.id === id)
          if (track && track.type === 'track') {
            const runLength = track.cfg.tunnel || track.cfg.bridge ? track.w : w
            station = resizeTrack(station, track, runLength, Math.max(track.d ?? 1, d))
          }
        }
      }
    }
    get().commit(station)
  },
})
