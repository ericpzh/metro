import { useEffect, useMemo, useRef } from 'react'
import { useStore, MODULE_OPTIONS } from './store.ts'
import { Viewport } from './Viewport.tsx'
import { countUpEscalators, paintZone, zoneAt } from '../build/model.ts'
import { FINISH_LIST, finishLabel } from '../sim/finishes.ts'
import { ZONE_LIST, zoneLabel } from '../sim/zones.ts'
import type { Zone } from '../sim/types.ts'
import { lineCapacityPerHour, trainRatedCapacity, STOCK } from '../sim/stock.ts'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 有点挤', D: 'D 拥挤', E: 'E 很挤', F: 'F 挤爆' }
const SPEEDS = [0, 1, 4, 16]

function TopBar(): React.ReactElement {
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const name = useStore((s) => s.station.name)
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
        <span className="stationName">{name}</span>
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

function LeftRail(): React.ReactElement {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const moduleType = useStore((s) => s.moduleType)
  const setModuleType = useStore((s) => s.setModuleType)
  const activeZ = useStore((s) => s.activeZ)
  const overlayOn = useStore((s) => s.overlayOn)
  const setOverlay = useStore((s) => s.setOverlay)
  const zoneOverlayOn = useStore((s) => s.zoneOverlayOn)
  const setZoneOverlay = useStore((s) => s.setZoneOverlay)
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
        <b>B</b> 建造 / 拆除
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
      <button className={tool === 'paint' ? 'railBtn on' : 'railBtn'} onClick={() => setTool('paint')}>
        <b>N</b> 材质 / 取色
      </button>
      {tool === 'paint' && <PaintPalette />}
      <button className={tool === 'zone' ? 'railBtn on' : 'railBtn'} onClick={() => setTool('zone')}>
        <b>Z</b> 分区
      </button>
      {tool === 'zone' && <ZonePalette />}
      <div className="groupTitle">楼层</div>
      <div className="row">
        <button className="chip" onClick={() => useStore.getState().stepLevel(1)} title="上一层 (Q)">
          Q ↑
        </button>
        <span className="coord">z = {activeZ}</span>
        <button className="chip" onClick={() => useStore.getState().stepLevel(-1)} title="下一层 (E)">
          E ↓
        </button>
      </div>
      <div className="groupTitle">视图</div>
      <button className={ortho ? 'railBtn on' : 'railBtn'} onClick={() => setOrtho(!ortho)}>
        <b>O</b> 平面 / 立体
      </button>
      <button className={ghost ? 'railBtn on' : 'railBtn'} onClick={() => setGhost(!ghost)}>
        <b>X</b> 显示其它层
      </button>
      <button className={cutaway ? 'railBtn on' : 'railBtn'} onClick={() => setCutaway(!cutaway)}>
        <b>C</b> 剖开
      </button>
      <button className={overlayOn ? 'railBtn on' : 'railBtn'} onClick={() => setOverlay(!overlayOn)}>
        拥挤热力
      </button>
      <button className={zoneOverlayOn ? 'railBtn on' : 'railBtn'} onClick={() => setZoneOverlay(!zoneOverlayOn)}>
        分区热力
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
        WASD 移动镜头 · Shift 加速 · Q/E 换层 · 鼠标贴边移动
        <br />
        中键拖动转视角 · 滚轮缩放
        <br />
        拖拽画一片 · Shift+拖拽画直线 · 右键删除
      </div>
    </div>
  )
}

const PAINT_FAMILIES: Array<{ key: string; label: string; ids: string[] }> = [
  { key: 'floor', label: '地面 / 轨道', ids: FINISH_LIST.filter((f) => f.family === 'floor' || f.family === 'track').map((f) => f.id) },
  { key: 'ceiling', label: '天花板', ids: FINISH_LIST.filter((f) => f.family === 'ceiling').map((f) => f.id) },
  { key: 'wall', label: '墙面', ids: FINISH_LIST.filter((f) => f.family === 'wall').map((f) => f.id) },
]

function PaintPalette(): React.ReactElement {
  const mode = useStore((s) => s.paintMode)
  const finish = useStore((s) => s.paintFinish)
  const setMode = useStore((s) => s.setPaintMode)
  const setFinish = useStore((s) => s.setPaintFinish)
  return (
    <div className="paintPanel">
      <div className="row">
        <button className={mode === 'single' ? 'chip on' : 'chip'} onClick={() => setMode('single')}>
          单块 N
        </button>
        <button className={mode === 'surface' ? 'chip on' : 'chip'} onClick={() => setMode('surface')}>
          整面 M
        </button>
        <button className={mode === 'pick' ? 'chip on' : 'chip'} onClick={() => setMode('pick')}>
          取色 I
        </button>
      </div>
      {PAINT_FAMILIES.map((fam) => (
        <div key={fam.key}>
          <div className="groupTitle">{fam.label}</div>
          <div className="palette">
            {fam.ids.map((id) => {
              const def = FINISH_LIST.find((f) => f.id === id)
              return (
                <button key={id} className={finish === id ? 'swatchBtn on' : 'swatchBtn'} title={finishLabel(id)} onClick={() => { setFinish(id); setMode('single') }}>
                  <i className="finishDot" style={{ background: `#${(def?.tint ?? 0x888888).toString(16).padStart(6, '0')}` }} />
                  <span>{finishLabel(id)}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="hint">左键刷，拖拽刷一整片；右键还原；整面 = 同一层连成一片的地方</div>
    </div>
  )
}

function ZonePalette(): React.ReactElement {
  const brush = useStore((s) => s.zoneBrush)
  const setBrush = useStore((s) => s.setZoneBrush)
  return (
    <div className="paintPanel">
      <div className="palette">
        {ZONE_LIST.map((z) => (
          <button key={z.id} className={brush === z.id ? 'swatchBtn on' : 'swatchBtn'} onClick={() => setBrush(z.id)}>
            <i className="finishDot" style={{ background: `#${z.colour.toString(16).padStart(6, '0')}` }} />
            <span>{z.label}</span>
          </button>
        ))}
      </div>
      <div className="hint">左键刷一片。付费区和非付费区之间，只有闸机过得去。</div>
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
  const upEsc = countUpEscalators(station)

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
          <div className="muted small">按 Del 删除，上面的设备也一起删掉</div>
        </div>
      ) : (
        <div className="muted small">点一下方块或设备就能选中。</div>
      )}
      {selected?.kind === 'cell' && <ZoneCard />}

      <div className="groupTitle">出入口客流</div>
      {exits.length === 0 && <div className="muted small">还没有出入口。</div>}
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
            <span>发车间隔</span>
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
          <div className="muted small">{STOCK[line.stock].doorsPerSide * line.cars} 个车门 · 出站不限速，来多少走多少</div>
        </div>
      ) : (
        <div className="muted small">还没有线路。</div>
      )}

      <div className="groupTitle">站台扶梯（易堵）</div>
      <div className="card">
        <div className="kv">
          <span>上行扶梯</span>
          <b>{upEsc} 台</b>
        </div>
        <div className="row">
          {[1, 2, 3].map((n) => (
            <button key={n} className={upEsc === n ? 'chip on' : 'chip'} onClick={() => useStore.getState().setUpEscalators(n)}>
              {n} 台
            </button>
          ))}
        </div>
        <div className="muted small">多加几台扶梯，站台就没那么挤；盯着底部的“滞留”看。</div>
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
      <Metric label="计算耗时" value={m ? `${m.tickMs.toFixed(1)} ms` : '—'} />
      <Metric label="网格耗时" value={stats ? `${stats.lastChunkMs.toFixed(1)} ms · ${stats.chunks}` : '—'} />
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
          st.stepLevel(1)
          break
        case 'e':
          st.stepLevel(-1)
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
              ? '建造：单击放一块，拖拽画一片，右键删除'
              : tool === 'module'
                ? '设备：先在左边选一种，再点地面放下去'
                : tool === 'paint'
                  ? '材质：左键刷一片，拖拽刷一整块，右键还原，I 键取色'
                  : tool === 'zone'
                    ? '分区：左键刷一片。付费区和非付费区之间只有闸机过得去'
                    : '选择：点一下方块或设备，看它的信息'}
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
