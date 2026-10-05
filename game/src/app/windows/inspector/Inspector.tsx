// Lane A split (Phase 1): moved verbatim from app/App.tsx — Inspector() is now
// the column shell only (plan.md R1/R3): folder open-state plus list mapping.
// Item bodies live in InfoCard / ExitCard / LineCard / ZoneCard. Folder still
// comes from ../LeftRail.tsx — it moves in Lane B, and this file must not
// reach into that lane's future folders (plan.md C1).
import { useMemo, useState } from 'react'
import { useStore } from '../../store.ts'
import { Folder } from '../../LeftRail.tsx'
import { InfoCard } from './InfoCard.tsx'
import { ExitCard } from './ExitCard.tsx'
import { LineCard } from './LineCard.tsx'

export function Inspector(): React.ReactElement {
  const station = useStore((s) => s.station)
  const addLine = useStore((s) => s.addLine)
  const [infoOpen, setInfoOpen] = useState(true)
  const [linesOpen, setLinesOpen] = useState(true)
  const [exitsOpen, setExitsOpen] = useState(true)
  // Per-line fold state. A line with no entry reads as open, so a freshly added
  // line starts expanded without seeding the map.
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})

  const exits = useMemo(() => station.modules.filter((m) => m.type === 'exit'), [station.modules])

  return (
    <div className="panel">
      <div className="railStamp">
        <span className="railStampTitle">信息栏</span>
        <span className="railStampSub">METRO / INSPECTOR</span>
      </div>

      <Folder title="信息" open={infoOpen} onToggle={() => setInfoOpen((v) => !v)}>
        <InfoCard />
      </Folder>

      <Folder title="出入口" count={exits.length} open={exitsOpen} onToggle={() => setExitsOpen((v) => !v)}>
        {exits.length === 0 && <div className="muted small">还没建出入口。</div>}
        {exits.map((m) => (m.type === 'exit' ? <ExitCard key={m.id} mod={m} /> : null))}
      </Folder>

      <Folder title="线路" count={station.lines.length} open={linesOpen} onToggle={() => setLinesOpen((v) => !v)}>
        {station.lines.length === 0 && (
          <div className="muted small">还没配线路。铺下第一段轨道时会自动新建，也可以在这里手动加。</div>
        )}
        {station.lines.map((line) => (
          <LineCard
            key={line.id}
            line={line}
            open={openLines[line.id] ?? true}
            onToggle={() => setOpenLines((o) => ({ ...o, [line.id]: !(o[line.id] ?? true) }))}
          />
        ))}
        <button className="chip" onClick={addLine}>
          + 新建线路
        </button>
      </Folder>
    </div>
  )
}
