import type { StationData } from './types.ts'

/** §5.4/§7: nonstructural settings and presentation changes never alter topology. */
export interface PopulationEdit {
  lines: Array<{ id: string; alightPerTrain: number }>
  exits: Array<{ id: string; inRate: number; open?: boolean; name?: string }>
  labels?: Array<{ id: string } & Partial<Pick<StationData['lines'][number], 'name' | 'colour' | 'upTerminus' | 'downTerminus' | 'upTerminusEn' | 'downTerminusEn'>>>
  station?: Pick<StationData, 'name' | 'nameEn'>
  headways?: Array<{ id: string; headwayProfile: StationData['lines'][number]['headwayProfile'] }>
  settings?: Pick<StationData, 'service' | 'peaks' | 'demand' | 'calendar'>
}

export function hasPresentationEdit(edit: PopulationEdit): boolean {
  return !!(edit.station || edit.labels?.length || edit.exits.some(e => e.name !== undefined))
}

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** Fail closed outside known runtime settings and presentation fields.
 * These edits have no geometry or walking-topology inputs. The cells
 * must be the same immutable array: do not scan a station's geometry per input. */
export function populationEdit(before: StationData, after: StationData): PopulationEdit | null {
  if (before.cells !== after.cells) return null
  const { cells: _bc, modules: bm, lines: bl, service: bs, peaks: bp, demand: bd, calendar: bc, name: bn, nameEn: be, ...b } = before
  const { cells: _ac, modules: am, lines: al, service, peaks, demand, calendar, name, nameEn, ...a } = after
  if (!same(b, a) || bm.length !== am.length || bl.length !== al.length) return null
  const edit: PopulationEdit = { lines: [], exits: [] }
  if (bn !== name || be !== nameEn) edit.station = { name, nameEn }
  if (!same(bs, service)) (edit.settings ??= {}).service = service
  if (!same(bp, peaks)) (edit.settings ??= {}).peaks = peaks
  if (!same(bd, demand)) (edit.settings ??= {}).demand = demand
  if (!same(bc, calendar)) (edit.settings ??= {}).calendar = calendar
  for (let i = 0; i < bl.length; i++) {
    if (bl[i] === al[i]) continue
    const { alightPerTrain: old, headwayProfile: oldHeadway, name: on, colour: oc, upTerminus: ou, downTerminus: od, upTerminusEn: oue, downTerminusEn: ode, ...rest } = bl[i]
    const { alightPerTrain: value, headwayProfile, name: nn, colour: nc, upTerminus: nu, downTerminus: nd, upTerminusEn: nue, downTerminusEn: nde, ...next } = al[i]
    if (!same(rest, next)) return null
    if (old !== value) edit.lines.push({ id: al[i].id, alightPerTrain: value })
    if (!same(oldHeadway, headwayProfile)) (edit.headways ??= []).push({ id: al[i].id, headwayProfile })
    if (!same([on,oc,ou,od,oue,ode],[nn,nc,nu,nd,nue,nde])) (edit.labels ??= []).push({ id: al[i].id,
      ...(on !== nn ? {name: nn} : {}), ...(oc !== nc ? {colour: nc} : {}),
      ...(oue !== nue ? {upTerminusEn: nue} : {}), ...(ode !== nde ? {downTerminusEn: nde} : {}),
      ...(ou !== nu ? {upTerminus: nu} : {}), ...(od !== nd ? {downTerminus: nd} : {}),
    })
  }
  for (let i = 0; i < bm.length; i++) {
    if (bm[i] === am[i]) continue
    const old = bm[i], next = am[i]
    if (old.type !== 'exit' || next.type !== 'exit') return null
    const { cfg: oldCfg, ...oldBase } = old, { cfg: nextCfg, ...nextBase } = next
    const { inRate: rate, open: oo, name: on, ...cfg } = oldCfg, { inRate: value, open, name, ...newCfg } = nextCfg
    if (!same(oldBase, nextBase) || !same(cfg, newCfg)) return null
    if (rate !== value || oo !== open || on !== name) edit.exits.push({ id: next.id, inRate: value, ...(oo !== open ? {open} : {}), ...(on !== name ? {name} : {}) })
  }
  return edit.lines.length || edit.exits.length || edit.headways || edit.settings || hasPresentationEdit(edit) ? edit : null
}

/** Apply to either the installed document or a pending topology build. */
export function applyPopulationEdit(data: StationData, edit: PopulationEdit): StationData {
  const lines = new Map(edit.lines.map(l => [l.id, l.alightPerTrain]))
  const exits = new Map(edit.exits.map(({id, ...cfg}) => [id, cfg]))
  const headways = new Map(edit.headways?.map(l => [l.id, l.headwayProfile]))
  const labels = new Map(edit.labels?.map(({id, ...label}) => [id, label]))
  return {
    ...data,
    ...edit.settings,
    ...edit.station,
    lines: data.lines.map(l => lines.has(l.id) || headways.has(l.id) || labels.has(l.id) ? {
      ...l,
      ...labels.get(l.id),
      ...(lines.has(l.id) ? { alightPerTrain: lines.get(l.id)! } : {}),
      ...(headways.has(l.id) ? { headwayProfile: headways.get(l.id)! } : {}),
    } : l),
    modules: data.modules.map(m => m.type === 'exit' && exits.has(m.id) ? { ...m, cfg: { ...m.cfg, ...exits.get(m.id)! } } : m),
  }
}
