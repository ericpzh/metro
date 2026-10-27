import type { Module, StationData } from '../sim/types.ts'
import type { PopulationEdit } from '../sim/populationEdit.ts'
import type { SignLayout } from '../sim/sign.ts'
import { floorMarkLine } from '../sim/floorDecor.ts'

// Authored metadata-independent geometry plus plates managed by PlateSystem.
// A future piece must declare its inputs before its model can be retained.
const RETAINED = new Set<Module['type']>([
  'sidewalk','lawn','tree','hanger','pillar','roof','gate','fence','escalator',
  'walkway','stair','lift','tvm','vending','bench','shelf','desk','checkout',
  'cubicle','sink', 'urinal','road','bin','extinguisher','light','clock','cctv','billboard',
  'glass','door','calligraphy','linemap','monitor','traffic-light','rail-signal',
  'tv','sign','retail','shop','booth','track','vent','ac-unit','electrical-cabinet','tactile',
])

export function signLineInk(layout: SignLayout, lines: StationData['lines']): string | null {
  if (layout.some(c => !['line','text','arrow','icon'].includes(c.kind))) return null
  return JSON.stringify(layout.filter(c => c.kind === 'line').map(c => {
    const line = c.lineId === '' ? lines[0] : lines.find(l => l.id === c.lineId) ?? lines[0]
    return [line?.id,line?.name,line?.colour]
  }))
}

/** §5.4/§5.7: only models with embedded station/line artwork need replacement.
 * Sign, TV and decor plates repaint their retained textures separately. */
export function presentationKeepIds(before: StationData, after: StationData, edit: PopulationEdit): Set<string> {
  const station = !!edit.station
  const shields = new Set(edit.labels?.filter(l=>l.name!==undefined || l.colour!==undefined).map(l=>l.id))
  const psdLines = new Set(edit.labels?.filter(l=>l.colour!==undefined || l.upTerminus!==undefined || l.downTerminus!==undefined || l.upTerminusEn!==undefined || l.downTerminusEn!==undefined).map(l=>l.id))
  const exitNames = new Set(edit.exits.filter(e => e.name !== undefined).map(e => e.id))
  const first = before.lines[0]?.id
  const keep = new Set<string>()
  for (const m of after.modules) {
    let replace = false
    if (m.type === 'platform-edge') {
      const line=before.lines.find(l=>l.id===m.cfg.line)??before.lines[0]
      replace = (m.cfg.psd??line?.psd)!=='none' && (station || psdLines.has(line?.id ?? ''))
    }
    else if (m.type === 'psd-end') replace = m.cfg.variant !== 'cover' && (m.cfg.psd??before.lines[0]?.psd??'full')==='full' &&
      !!edit.labels?.some(l=>l.id===first && l.colour!==undefined)
    else if (m.type === 'floor-mark') replace = shields.has(floorMarkLine(m,before.lines).id)
    else if (m.type === 'exit') replace = m.cfg.style!=='virtual' && (station || exitNames.has(m.id))
    else if (m.type === 'guidepost') replace = station || exitNames.has(m.cfg.exitId ?? '')
    else if (m.type === 'busstop') replace = before.name !== after.name
    else replace = !RETAINED.has(m.type)
    if (!replace) keep.add(m.id)
  }
  return keep
}
