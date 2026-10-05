// Lane A split (Phase 1): moved verbatim from app/App.tsx — the cell-selection
// 分区 card (GAME-SPEC.md §4 zoning: paintZone commits through the store).
import { useStore } from '../../store.ts'
import { paintZone, zoneAt } from '../../../build/model.ts'
import { ZONE_LIST, zoneLabel } from '../../../sim/zones.ts'
import type { Zone } from '../../../sim/types.ts'

export function ZoneCard(): React.ReactElement | null {
  const selected = useStore((s) => s.selected)
  const station = useStore((s) => s.station)
  const commit = useStore((s) => s.commit)
  if (!selected || selected.kind !== 'cell') return null
  const [x, y, z] = selected.key.split(',').map(Number)
  const zone = zoneAt(station.cells, x, y, z)
  const set = (next: Zone): void => commit(paintZone(station, x, y, z, next, false))
  return (
    <div className="card">
      <div className="kv">
        <span>分区</span>
        <b>{zoneLabel(zone)}</b>
      </div>
      <div className="row">
        {ZONE_LIST.map((zz) => (
          <button key={zz.id} className={zone === zz.id ? 'chip on' : 'chip'} onClick={() => set(zz.id)}>
            {zz.label}
          </button>
        ))}
      </div>
    </div>
  )
}
