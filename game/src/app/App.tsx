import { useEffect, useMemo } from 'react'
import { useStore, MODULE_OPTIONS } from './store.ts'
import { Viewport } from './Viewport.tsx'
import { countUpEscalators } from '../build/model.ts'
import { lineCapacityPerHour, trainRatedCapacity, STOCK } from '../sim/stock.ts'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 受限', D: 'D 拥挤', E: 'E 停滞', F: 'F 危险' }
const SPEEDS = [0, 1, 4, 16]

function TopBar(): React.ReactElement {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const name = useStore((s) => s.station.name)
  const setPlaying = useStore((s) => s.setPlaying)
  const setSpeed = useStore((s) => s.setSpeed)
  const newStation = useStore((s) => s.newStation)
  const loadReference = useStore((s) => s.loadReference)
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">地铁站设计师</span>
        <span className="stationName">{name}</span>
      </div>
      <div className="spacer" />
      <button className="ghost" onClick={newStation} title="2×2 起点">
        新建
      </button>
      <button className="ghost" onClick={loadReference}>
        参考站（五四广场）
      </button>
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

function LeftRail(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const activeZ = useStore((s) => s.activeZ)
  const overlayOn = useStore((s) => s.overlayOn)
  const setOverlay = useStore((s) => s.setOverlay)
  const cutaway = useStore((s) => s.cutaway)
  const setCutaway = useStore((s) => s.setCutaway)
  const ortho = useStore((s) => s.ortho)
  const setOrtho = useStore((s) => s.setOrtho)
  const ghost = useStore((s) => s.ghostOtherLevels)
  const setGhost = useStore((s) => s.setGhostOther)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  return (
    <div className="rail">
      <div className="groupTitle">工具</div>
      <button className={tool === 'select' ? 'railBtn on' : 'railBtn'} onClick={() => setTool('select')}>
        <b>V</b> 选择
      </button>
      <button className={tool === 'block' ? 'railBtn on' : 'railBtn'} onClick={() => setTool('block')}>
        <b>B</b> 砌块 / 挖掘
      </button>
      <button className={tool === 'module' ? 'railBtn on' : 'railBtn'} onClick={() => setTool('module')}>
        <b>J</b> 设备
      </button>
      {tool === 'module' && (
        <div className="moduleList">
          {MODULE_OPTIONS.map((m) => (
            <button key={m.id} className={moduleType === m.id ? 'chip on' : 'chip'} onClick={() => setModuleType(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="groupTitle">楼层</div>
      <div className="row">
        <button className="chip" onClick={() => useStore.getState().stepLevel(1)} title="上一层 (E)">
          E ↑
        </button>
        <span className="coord">z = {activeZ}</span>
        <button className="chip" onClick={() => useStore.getState().stepLevel(-1)} title="下一层 (Q)">
          Q ↓
        </button>
      </div>
      <div className="groupTitle">视图</div>
      <button className={ortho ? 'railBtn on' : 'railBtn'} onClick={() => setOrtho(!ortho)}>
        <b>O</b> 正交 / 透视
      </button>
      <button className={ghost ? 'railBtn on' : 'railBtn'} onClick={() => setGhost(!ghost)}>
        <b>X</b> 其它层幽灵
      </button>
      <button className={cutaway ? 'railBtn on' : 'railBtn'} onClick={() => setCutaway(!cutaway)}>
        <b>C</b> 剖切
      </button>
      <button className={overlayOn ? 'railBtn on' : 'railBtn'} onClick={() => setOverlay(!overlayOn)}>
        密度热力 (LOS)
      </button>
      <div className="groupTitle">编辑</div>
      <div className="row">
        <button className="chip" onClick={undo}>
          Ctrl+Z 撤销
        </button>
        <button className="chip" onClick={redo}>
          Ctrl+Y 重做
        </button>
      </div>
      <div className="hint">
        左键放置 / 右键删除
        <br />
        Shift = 直线，拖拽 = 矩形
      </div>
    </div>
  )
}

function Inspector(): React.ReactElement {
  const station = useStore((s) => s.station)
  const selected = useStore((s) => s.selected)
  const commit = useStore((s) => s.commit)
  const upEsc = countUpEscalators(station)

  const exits = useMemo(() => station.modules.filter((m) => m.type === 'exit'), [station.modules])
  const line = station.lines[0]

  const setExit = (id: string, patch: Partial<{ inRate: number; outRate: number; open: boolean; name: string }>): void => {
    const modules = station.modules.map((m) => (m.id === id && m.type === 'exit' ? { ...m, cfg: { ...m.cfg, ...patch } } : m))
    commit({ ...station, modules })
  }

  return (
    <div className="panel">
      <div className="groupTitle">检查器</div>
      {selected ? (
        <div className="card">
          <div className="kv">
            <span>选择</span>
            <b>{selected.label}</b>
          </div>
          <div className="kv">
            <span>类型</span>
            <b>{selected.kind === 'module' ? '设备' : '方块'}</b>
          </div>
          <div className="muted small">Del 删除所选方块（其上的设备一并移除）</div>
        </div>
      ) : (
        <div className="muted small">点击方块或设备以选中。</div>
      )}

      <div className="groupTitle">出入口 客流输入</div>
      {exits.length === 0 && <div className="muted small">本站无出入口。</div>}
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
            <label className="field">
              <span>出站 {m.cfg.outRate} 人/时</span>
              <input type="range" min={0} max={6000} step={10} value={m.cfg.outRate} onChange={(e) => setExit(m.id, { outRate: Number(e.target.value) })} />
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
            <span>高峰间隔</span>
            <b>{Math.round(line.headwayProfile.peak)} 秒</b>
          </div>
          <div className="kv">
            <span>载客量</span>
            <b>
              {trainRatedCapacity(line)} 人/列 · {lineCapacityPerHour(line).toLocaleString()} 人/时
            </b>
          </div>
          <div className="muted small">{STOCK[line.stock].doorsPerSide * line.cars} 门 · 下行 45% 下车</div>
        </div>
      ) : (
        <div className="muted small">无线路。</div>
      )}

      <div className="groupTitle">站台扶梯（瓶颈）</div>
      <div className="card">
        <div className="kv">
          <span>疏散扶梯</span>
          <b>{upEsc} 台</b>
        </div>
        <div className="row">
          {[1, 2, 3].map((n) => (
            <button key={n} className={upEsc === n ? 'chip on' : 'chip'} onClick={() => useStore.getState().setUpEscalators(n)}>
              {n} 台
            </button>
          ))}
        </div>
        <div className="muted small">加装扶梯即可缓解站台挤压，观察“遗留”计数变化。</div>
      </div>
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
      <Metric label="最差 LOS" value={m ? LOS_LABEL[m.worstLos] : '—'} tone={m?.worstLos} />
      <Metric label="闸机排队" value={m ? m.gateQueue : '—'} />
      <Metric label="扶梯排队" value={m ? m.escalatorQueue : '—'} />
      <Metric label="站台门排队" value={m ? m.doorQueue : '—'} />
      <Metric label="已上车" value={m ? m.boarded : '—'} />
      <Metric label="已出站" value={m ? m.exited : '—'} />
      <Metric label="遗留" value={m ? m.leftBehind : '—'} warn={(m?.leftBehind ?? 0) > 0} />
      <Metric label="时刻" value={m ? clock(m.simTime) : '—'} />
      <span className="spacer" />
      <Metric label="FPS" value={stats ? stats.fps : '—'} />
      <Metric label="worker tick" value={m ? `${m.tickMs.toFixed(1)} ms` : '—'} />
      <Metric label="区块网格" value={stats ? `${stats.lastChunkMs.toFixed(1)} ms · ${stats.chunks}` : '—'} />
      <Metric label="方块" value={station.cells.length} />
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
  const setTool = useStore((s) => s.setTool)

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
          <div className="stageHint">{tool === 'block' ? '砌块：左键放置 / 右键删除 · 拖拽为矩形' : tool === 'module' ? '设备：点选目录后点击地面' : '选择：点击方块查看'}</div>
        </div>
        <Inspector />
      </div>
      <BottomBar />
    </div>
  )
}
