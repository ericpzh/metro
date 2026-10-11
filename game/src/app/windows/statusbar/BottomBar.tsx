import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — BottomBar() plus
// its metrics. The clock column reads `sim/clock.ts` and the level-of-service
// labels come from `sim/constants.ts`, the same pair the 时刻 window prints.
import { useStore } from '../../store.ts'
import { LOS_LABELS } from '../../../sim/constants.ts'
import { stampAt } from '../../../sim/clock.ts'
import { Metric } from './Metric.tsx'

export function BottomBar(): React.ReactElement {
  useLanguage()
  const m = useStore((s) => s.metrics)
  const stats = useStore((s) => s.stats)
  const station = useStore((s) => s.station)
  return (
    <div className="bottombar">
      <Metric label={t('passengers_inside')} value={m ? m.population.toLocaleString() : '—'} />
      <Metric label={t('worst_crowd_level')} value={m ? `${m.worstLos} ${LOS_LABELS[m.worstLos]}` : '—'} tone={m?.worstLos} />
      <Metric label={t('gate_queue')} value={m ? m.gateQueue : '—'} />
      <Metric label={t('escalator_queue')} value={m ? m.escalatorQueue : '—'} />
      <Metric label={t('lift_queue')} value={m ? m.liftQueue : '—'} />
      <Metric label={t('platform_door_queue')} value={m ? m.doorQueue : '—'} />
      <Metric label={t('boarded')} value={m ? m.boarded : '—'} />
      <Metric label={t('exited')} value={m ? m.exited : '—'} />
      <Metric label={t('left_behind')} value={m ? m.leftBehind : '—'} warn={(m?.leftBehind ?? 0) > 0} />
      <Metric label={t('time_440')} value={m ? stampAt(m.simTime).clock : '—'} />
      <span className="spacer" />
      <Metric label={t('fps')} value={stats ? stats.fps : '—'} />
      <Metric label={t('blocks')} value={station.cells.length} />
    </div>
  )
}
