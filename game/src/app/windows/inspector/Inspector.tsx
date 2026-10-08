// Lane A split (Phase 1): moved verbatim from app/App.tsx — Inspector() is now
// the column shell only (plan.md R1/R3): folder open-state plus list mapping.
// Item bodies live in InfoCard / ExitCard / LineCard / ZoneCard. Folder still
// comes from ../LeftRail.tsx — it moves in Lane B, and this file must not
// reach into that lane's future folders (plan.md C1).
//
// **The column's four folders are one table** (`INSPECTOR_FOLDERS`,
// `app/rail/helpers.ts`) — 信息 / 视图 / 出入口 / 线路, in this order, each with the
// **Alt+letter** its header badges — exactly as the build rail's stack is `RAIL_FOLDERS`
// one column over. This file supplies only what a table cannot: the open-state, the count
// and the body of each row. 视图 moved here from the build rail because its tiles
// (显示其他层 / 剖切 / 隐藏UI / 隐藏天花板 / 隐藏墙壁 / 隐藏地面 / 隐藏屋顶 / 分区图 / 热力图) are controls over how
// the station is *drawn* rather than pieces of it, and the panel is the wider column
// (`styles.css` `.main` / `.panel .blockGrid`), so its tiles fit three to a row.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store.ts'
import { Folder } from '../../LeftRail.tsx'
import { INSPECTOR_FOLDERS } from '../../rail/helpers.ts'
import type { InspectorFolderKey } from '../../rail/helpers.ts'
import { ViewFolder } from '../../rail/folders/ViewFolder.tsx'
import { InfoCard } from './InfoCard.tsx'
import { ClockCard } from './ClockCard.tsx'
import { ExitCard } from './ExitCard.tsx'
import { LineCard } from './LineCard.tsx'

/** The 信息栏's own folder keys, so a rail folder's Shift+letter is not folded here. */
const INSPECTOR_FOLDER_KEYS: ReadonlySet<string> = new Set(INSPECTOR_FOLDERS.map((f) => f.key))

export function Inspector(): React.ReactElement {
  const station = useStore((s) => s.station)
  const addLine = useStore((s) => s.addLine)
  // Every row of the stack opens where the player needs it: the report sections, and
  // 视图 with them — the view toggles are the row a build starts from (which storey is
  // drawn, the street and the walls off, the overlays on), so a folder that started
  // folded would be one Alt+W before the first thing anyone wants.
  const [open, setOpen] = useState<Record<InspectorFolderKey, boolean>>({
    info: true,
    view: true,
    exits: true,
    lines: true,
  })
  // Per-line fold state. A line with no entry reads as open, so a freshly added
  // line starts expanded without seeding the map.
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})

  // The column's Alt+letter, handed over by the app's one keydown listener as
  // `metro:folder` — the rail's own split, one column over (`rail/LeftRail.tsx`): the
  // listener knows the table, this column knows whether its folder is open. The rail
  // drops the keys it does not own the same way, so one letter folds one header.
  useEffect(() => {
    const onFolder = (e: Event): void => {
      const key = (e as CustomEvent).detail as string
      if (!INSPECTOR_FOLDER_KEYS.has(key)) return
      const inspectorKey = key as InspectorFolderKey
      setOpen((prev) => ({ ...prev, [inspectorKey]: !prev[inspectorKey] }))
    }
    window.addEventListener('metro:folder', onFolder)
    return () => window.removeEventListener('metro:folder', onFolder)
  }, [])

  const toggle = (k: InspectorFolderKey): void => setOpen((o) => ({ ...o, [k]: !o[k] }))

  const exits = useMemo(() => station.modules.filter((m) => m.type === 'exit'), [station.modules])

  // What each row shows and the count its header prints — the one half of a folder the
  // table cannot carry. 视图's is its own nine tiles (显示其他层 / 剖切 / 隐藏UI /
  // 隐藏天花板 / 隐藏墙壁 / 隐藏地面 / 隐藏屋顶 / 分区图 / 热力图): 剖切 folds its 旋转 + 隐藏剖切面 row
  // out, and a folded-out row is not a tile — the rule the build rail's headers print by
  // too (`rail/helpers.ts` `toolsFolderTiles`), so the count does not change with the cut.
  const folders: Record<InspectorFolderKey, { count?: number; body: React.ReactNode }> = {
    info: { body: <InfoCard /> },
    view: { count: 9, body: <ViewFolder /> },
    exits: {
      count: exits.length,
      body: (
        <>
          {exits.length === 0 && <div className="muted small">还没建出入口。</div>}
          {exits.map((m) => (m.type === 'exit' ? <ExitCard key={m.id} mod={m} /> : null))}
        </>
      ),
    },
    lines: {
      count: station.lines.length,
      body: (
        <>
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
        </>
      ),
    },
  }

  return (
    <div className="panel">
      {/* The column's **fixed head**: the stamp and the clock, full width to the column's own
          right edge (the head has no right padding, which is the gap the card used to keep),
          and outside the scroller so the clock stays put while the folders below it move. */}
      <div className="panelHead">
        <div className="railStamp">
          <span className="railStampTitle">信息栏</span>
          <span className="railStampSub">METRO / INSPECTOR</span>
        </div>
        <ClockCard />
      </div>

      <div className="panelBody">
        {/* Stacked in the table's order, so the Alt+letter that folds a folder and the row
            it sits in are the same list read two ways (`INSPECTOR_FOLDERS`). */}
        {INSPECTOR_FOLDERS.map(({ key, title, alt }) => (
          <Folder
            key={key}
            title={title}
            count={folders[key].count}
            shortcut={`Alt+${alt}`}
            open={open[key]}
            onToggle={() => toggle(key)}
          >
            {folders[key].body}
          </Folder>
        ))}
      </div>
    </div>
  )
}
