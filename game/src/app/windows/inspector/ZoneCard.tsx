// Lane A split (Phase 1): moved verbatim from app/App.tsx — the cell-selection
// 分区 card (GAME-SPEC.md §4 zoning: paintZone commits through the store).
//
// The card is a zone brush over the selected cell, so it is bound by the same rule
// the drag tool is: a zone belongs to **floor** (§4.5). A selected wall coping or
// ceiling shows its reading and a line saying why nothing can be set — a row of
// chips that wrote a label no overlay could draw is what this replaces.
//
// **无分区 is the first chip**, and it is the one that *erases*: the zone a cell
// reads when it carries no label of its own (`zoneOf`). So the row is the six
// states a floor cell can be in, and the way to the first of them is to take the
// label off rather than to write one that says "nothing" (`eraseZoneCells`). It is
// also the one control here that a cell which is *not* floor can still use, since
// removing a stale label is legal wherever a label is.
import { useStore } from '../../store.ts'
import { eraseZoneCells, paintZone, zoneAt, zoneFloorAt } from '../../../build/model.ts'
import { ZONE_LIST, zoneLabel } from '../../../sim/zones.ts'
import { DEFAULT_ZONE, type Zone } from '../../../sim/types.ts'

export function ZoneCard(): React.ReactElement | null {
  const selected = useStore((s) => s.selected)
  const station = useStore((s) => s.station)
  const commit = useStore((s) => s.commit)
  if (!selected || selected.kind !== 'cell') return null
  const [x, y, z] = selected.key.split(',').map(Number)
  const zone = zoneAt(station.cells, x, y, z)
  const paintable = zoneFloorAt(station.cells, station.modules, x, y, z)
  // The cell's own label, as opposed to the zone it reads: 无分区 has nothing to do
  // when the reading already *is* 无分区.
  const labelled = station.cells.some((c) => c.x === x && c.y === y && c.z === z && c.zone !== undefined)
  const clear = (): void => commit(eraseZoneCells(station, [[x, y, z]]))
  return (
    <div className="card">
      <div className="kv">
        <span>分区</span>
        <b>{zoneLabel(zone)}</b>
      </div>
      <div className="row">
        {ZONE_LIST.map((zz) =>
          zz.id === DEFAULT_ZONE ? (
            <button key={zz.id} className={zone === zz.id ? 'chip on' : 'chip'} disabled={!labelled} onClick={clear}>
              {zz.label}
            </button>
          ) : (
            <button
              key={zz.id}
              className={zone === zz.id ? 'chip on' : 'chip'}
              disabled={!paintable}
              onClick={() => commit(paintZone(station, x, y, z, zz.id as Zone, false))}
            >
              {zz.label}
            </button>
          ),
        )}
      </div>
      {!paintable && <div className="muted small">分区只能画在地板上（这一格不是地面）</div>}
    </div>
  )
}
