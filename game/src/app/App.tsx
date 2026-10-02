import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, isEscalatorType, isRotatableType, isStairType } from './store.ts'
import { LeftRail } from './LeftRail.tsx'
import { Viewport } from './Viewport.tsx'
import { paintZone, zoneAt } from '../build/model.ts'
import { ZONE_LIST, zoneLabel } from '../sim/zones.ts'
import type { Zone } from '../sim/types.ts'
import { lineCapacityPerHour, trainRatedCapacity, STOCK } from '../sim/stock.ts'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 有点挤', D: 'D 拥挤', E: 'E 很挤', F: 'F 挤爆' }
const SPEEDS = [0, 1, 4, 16]

/**
 * The station title in the top bar. Click to edit: Enter or blur keeps the
 * change, Escape throws it away. An empty name is refused by the store.
 */
function StationName(): React.ReactElement {
  const name = useStore((s) => s.station.name)
  const renameStation = useStore((s) => s.renameStation)
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)

  const start = (): void => {
    cancelled.current = false
    setDraft(name)
  }
  // Runs on blur and on Enter. Escape flags the field first, so the blur that
  // follows an unmount does not overwrite the name it just discarded.
  const save = (): void => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    if (draft !== null) renameStation(draft)
    setDraft(null)
  }
  const cancel = (): void => {
    cancelled.current = true
    setDraft(null)
  }

  if (draft === null) {
    return (
      <button className="stationName" onClick={start} title="点击重命名车站">
        {name || '未命名车站'}
      </button>
    )
  }
  return (
    <input
      className="stationNameInput"
      value={draft}
      autoFocus
      maxLength={24}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancel()
        }
      }}
    />
  )
}

function TopBar(): React.ReactElement {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const setPlaying = useStore((s) => s.setPlaying)
  const setSpeed = useStore((s) => s.setSpeed)
  const newStation = useStore((s) => s.newStation)
  const loadReference = useStore((s) => s.loadReference)
  const saveToFile = useStore((s) => s.saveToFile)
  const loadFromText = useStore((s) => s.loadFromText)
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">地铁站设计师</span>
        <StationName />
      </div>
      <div className="spacer" />
      <button className="ghost" onClick={newStation} title="从一块 2×2 空地开始">
        新建
      </button>
      <button className="ghost" onClick={loadReference}>
        示例车站
      </button>
      <button className="ghost" onClick={saveToFile} title="保存到文件">
        保存
      </button>
      <button className="ghost" onClick={() => fileRef.current?.click()}>
        打开
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void f.text().then(loadFromText)
          e.target.value = ''
        }}
      />
      <button className="primary" onClick={() => setPlaying(!playing)}>
        {playing ? '暂停' : '播放'}
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'chip on' : 'chip'} onClick={() => setSpeed(s)}>
            {s === 0 ? '暂停' : `${s}×`}
          </button>
        ))}
      </div>
    </div>
  )
}

function ZoneCard(): React.ReactElement | null {
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

function Inspector(): React.ReactElement {
  const station = useStore((s) => s.station)
  const selected = useStore((s) => s.selected)
  const commit = useStore((s) => s.commit)

  const exits = useMemo(() => station.modules.filter((m) => m.type === 'exit'), [station.modules])
  const line = station.lines[0]

  const setExit = (id: string, patch: Partial<{ inRate: number; open: boolean; name: string }>): void => {
    const modules = station.modules.map((m) => (m.id === id && m.type === 'exit' ? { ...m, cfg: { ...m.cfg, ...patch } } : m))
    commit({ ...station, modules })
  }

  const setLine = (id: string, patch: Partial<{ alightPerTrain: number }>): void => {
    const lines = station.lines.map((l) => (l.id === id ? { ...l, ...patch } : l))
    commit({ ...station, lines })
  }

  return (
    <div className="panel">
      <div className="groupTitle">信息</div>
      {selected ? (
        <div className="card">
          <div className="kv">
            <span>已选</span>
            <b>{selected.label}</b>
          </div>
          <div className="kv">
            <span>类型</span>
            <b>{selected.kind === 'module' ? '设备' : '方块'}</b>
          </div>
          <div className="muted small">按 Del 删除；上面有设备，就一起拆掉</div>
        </div>
      ) : (
        <div className="muted small">点一下方块或设备，就能选中。</div>
      )}
      {selected?.kind === 'cell' && <ZoneCard />}

      <div className="groupTitle">出入口客流</div>
      {exits.length === 0 && <div className="muted small">还没建出入口。</div>}
      {exits.map((m) =>
        m.type === 'exit' ? (
          <div className="card" key={m.id}>
            <div className="kv">
              <span>名称</span>
              <b>{m.cfg.name}</b>
            </div>
            <label className="field">
              <span>进站 {m.cfg.inRate} 人/时</span>
              <input type="range" min={0} max={6000} step={10} value={m.cfg.inRate} onChange={(e) => setExit(m.id, { inRate: Number(e.target.value) })} />
            </label>
            <label className="field inline">
              <input type="checkbox" checked={m.cfg.open} onChange={(e) => setExit(m.id, { open: e.target.checked })} />
              <span>开放</span>
            </label>
          </div>
        ) : null,
      )}

      <div className="groupTitle">线路</div>
      {line ? (
        <div className="card">
          <div className="kv">
            <span>线路</span>
            <b>
              <i className="swatch" style={{ background: line.colour }} /> {line.name} · {line.stock}型{line.cars}节
            </b>
          </div>
          <div className="kv">
            <span>高峰发车间隔</span>
            <b>{Math.round(line.headwayProfile.peak)} 秒</b>
          </div>
          <div className="kv">
            <span>载客量</span>
            <b>
              {trainRatedCapacity(line)} 人/列 · {lineCapacityPerHour(line).toLocaleString()} 人/时
            </b>
          </div>
          <label className="field">
            <span>每列下车 {line.alightPerTrain} 人</span>
            <input type="range" min={0} max={1500} step={10} value={line.alightPerTrain} onChange={(e) => setLine(line.id, { alightPerTrain: Number(e.target.value) })} />
          </label>
          <div className="muted small">{STOCK[line.stock].doorsPerSide * line.cars} 个车门 · 出站不限流，来多少走多少</div>
        </div>
      ) : (
        <div className="muted small">还没配线路。</div>
      )}
    </div>
  )
}

function BottomBar(): React.ReactElement {
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
      <Metric label="仿真耗时" value={m ? `${m.tickMs.toFixed(1)} ms` : '—'} />
      <Metric label="网格构建" value={stats ? `${stats.lastChunkMs.toFixed(1)} ms · ${stats.chunks}` : '—'} />
      <Metric label="方块数" value={station.cells.length} />
    </div>
  )
}

function clock(t: number): string {
  const h = Math.floor(t / 3600) % 24
  const mm = Math.floor((t % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function Metric({ label, value, warn, tone }: { label: string; value: string | number; warn?: boolean; tone?: string }): React.ReactElement {
  const cls = warn ? 'metric warn' : tone === 'F' || tone === 'E' ? 'metric danger' : 'metric'
  return (
    <div className={cls}>
      <span className="metricLabel">{label}</span>
      <b>{value}</b>
    </div>
  )
}

export function App(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const moduleType = useStore((s) => s.moduleType)
  const setTool = useStore((s) => s.setTool)
  const notice = useStore((s) => s.notice)

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => useStore.getState().setNotice(null), 3200)
    return () => window.clearTimeout(id)
  }, [notice])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      switch (e.key.toLowerCase()) {
        case 'v':
          setTool('select' as const)
          break
        case 'b':
          st.setTool('block')
          break
        case 'j':
          st.setTool('module')
          break
        case 'r':
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          e.preventDefault()
          if (isStairType(st.moduleType)) st.cycleStairWidth()
          else if (isEscalatorType(st.moduleType)) st.cycleEscalatorDir()
          break
        case 'n':
          st.setTool('paint')
          st.setPaintMode('single')
          break
        case 'm':
          st.setTool('paint')
          st.setPaintMode('surface')
          break
        case 'i':
          st.setTool('paint')
          st.setPaintMode('pick')
          break
        case 'q':
          st.stepLevel(-1)
          break
        case 'e':
          st.stepLevel(1)
          break
        case 'x':
          st.setGhostOther(!st.ghostOtherLevels)
          break
        case 'c':
          st.setCutaway(!st.cutaway)
          break
        case 'o':
          st.setOrtho(!st.ortho)
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          window.dispatchEvent(new CustomEvent('metro:preset', { detail: e.key }))
          break
        case 'f':
          window.dispatchEvent(new CustomEvent('metro:frame'))
          break
        case 'delete':
        case 'backspace':
          window.dispatchEvent(new CustomEvent('metro:delete'))
          break
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) st.redo()
            else st.undo()
          } else {
            st.setTool('zone')
          }
          break
        case 'y':
          if (e.ctrlKey || e.metaKey) st.redo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTool])

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftRail />
        <div className="stage">
          <Viewport />
          <div className="stageHint">
            {tool === 'block'
              ? '建造：单击放一块，按住拖出一片，右键删除'
              : tool === 'module'
                ? isStairType(moduleType)
                  ? '楼梯：点地面放下，能转方向、调宽度，右键拆掉'
                  : isEscalatorType(moduleType)
                    ? '扶梯：点地面放下，能转方向、切上下行，右键拆掉'
                    : '设备：左边选一种，点地面放下，能转方向，右键拆掉'
                : tool === 'paint'
                  ? '材质：左键刷一格，拖拽刷一片，右键还原，取色能吸'
                  : tool === 'zone'
                    ? '分区：左键点或拖框上色；商店/售票亭拖框建，墙上右键开门'
                    : '选择：点方块或设备，看它是什么'}
          </div>
        </div>
        <Inspector />
      </div>
      <BottomBar />
      {notice && (
        <div className="toast" onClick={() => useStore.getState().setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  )
}
