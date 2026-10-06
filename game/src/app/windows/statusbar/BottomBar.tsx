// Lane A split (Phase 1): moved verbatim from app/App.tsx — BottomBar() plus
// its metrics. The clock column reads `sim/clock.ts` and the level-of-service
// labels come from `sim/constants.ts`, the same pair the 时刻 window prints.
import { useStore } from '../../store.ts'
import { LOS_LABELS } from '../../../sim/constants.ts'
import { stampAt } from '../../../sim/clock.ts'
import { Metric } from './Metric.tsx'

export function BottomBar(): React.ReactElement {
  const m = useStore((s) => s.metrics)
  const stats = useStore((s) => s.stats)
  const station = useStore((s) => s.station)
  return (
    <div className="bottombar">
      <Metric label="站内人数" value={m ? m.population.toLocaleString() : '—'} />
      <Metric label="最挤等级" value={m ? `${m.worstLos} ${LOS_LABELS[m.worstLos]}` : '—'} tone={m?.worstLos} />
      <Metric label="闸机排队" value={m ? m.gateQueue : '—'} />
      <Metric label="扶梯排队" value={m ? m.escalatorQueue : '—'} />
      <Metric label="电梯排队" value={m ? m.liftQueue : '—'} />
      <Metric label="站台门排队" value={m ? m.doorQueue : '—'} />
      <Metric label="已上车" value={m ? m.boarded : '—'} />
      <Metric label="已出站" value={m ? m.exited : '—'} />
      <Metric label="滞留" value={m ? m.leftBehind : '—'} warn={(m?.leftBehind ?? 0) > 0} />
      <Metric label="时间" value={m ? stampAt(m.simTime).clock : '—'} />
      <span className="spacer" />
      <Metric label="FPS" value={stats ? stats.fps : '—'} />
      <Metric label="方块数" value={station.cells.length} />
    </div>
  )
}
