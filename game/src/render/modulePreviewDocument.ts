import type { Module, StationData } from '../sim/types.ts'

// These builders never need their own candidate in the station's module list.
// Their support/curtain/hanger queries can reuse the prepared immutable document.
// Coupled multi-piece/rail/TV previews retain the merged-document contract.
const STATION_PREVIEWS = new Set<Module['type']>([
  'bench', 'tvm', 'vending', 'shelf', 'desk', 'checkout', 'cubicle', 'sink', 'bin',
  'extinguisher', 'ac-unit', 'electrical-cabinet', 'booth', 'roof', 'pillar', 'hanger',
  'gate', 'fence', 'light', 'vent', 'clock', 'cctv', 'monitor', 'sign', 'billboard',
  'door', 'calligraphy', 'linemap', 'floor-mark', 'guidepost', 'busstop', 'traffic-light',
  'rail-signal', 'sidewalk', 'lawn', 'tree', 'shop',
])

/** One bounded cache for the carried piece's removal, not one filtered station
 * per pointer cell. Ordinary equipment hovers use the original document itself. */
export class ModulePreviewDocument {
  private station: StationData | null = null
  private movingId: string | null = null
  private base: StationData | null = null

  resolve(station: StationData, mods: readonly Module[], movingId: string | null): StationData {
    if (station !== this.station || movingId !== this.movingId) {
      this.station = station
      this.movingId = movingId
      this.base = movingId === null ? station : { ...station, modules: station.modules.filter(m => m.id !== movingId) }
    }
    const base = this.base!
    if (mods.every(m => STATION_PREVIEWS.has(m.type))) return base
    return { ...base, modules: [...base.modules, ...mods] }
  }
}
