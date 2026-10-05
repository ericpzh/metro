// Lane A split (Phase 1): moved verbatim from app/App.tsx — BottomBar() plus
// its private LOS_LABEL map and clock() formatter.
import { useStore } from '../../store.ts'
import { Metric } from './Metric.tsx'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 有点挤', D: 'D 拥挤', E: 'E 很挤', F: 'F 挤爆' }

export function BottomBar(): React.ReactElement {
  const m = useStore((s) => s.metrics)
  const stats = useStore((s) => s.stats)
  const station = useStore((s) => s.station)
  return (
    <div className="bottombar">
      <Metric label="站内人数" value={m ? m.population.toLocaleString() : '—'} />
      <Metric label="最挤等级" value={m ? LOS_LABEL[m.worstLos] : '—'} tone={m?.worstLos} />
      <Metric label="闸机排队" value={m ? m.gateQueue : '—'} />
      <Metric label="扶梯排队" value={m ? m.escalatorQueue : '—'} />
      <Metric label="站台门排队" value={m ? m.doorQueue : '—'} />
      <Metric label="已上车" value={m ? m.boarded : '—'} />
      <Metric label="已出站" value={m ? m.exited : '—'} />
      <Metric label="滞留" value={m ? m.leftBehind : '—'} warn={(m?.leftBehind ?? 0) > 0} />
      <Metric label="时间" value={m ? clock(m.simTime) : '—'} />
      <span className="spacer" />
      <Metric label="FPS" value={stats ? stats.fps : '—'} />
      <Metric label="方块数" value={station.cells.length} />
    </div>
  )
}

function clock(t: number): string {
  const h = Math.floor(t / 3600) % 24
  const mm = Math.floor((t % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
