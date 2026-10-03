import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, isDecorType, isEscalatorType, isFenceType, isRotatableType, isStairType, isWallMountedType, moduleLabel } from './store.ts'
import { Folder, LeftRail } from './LeftRail.tsx'
import { Viewport } from './Viewport.tsx'
import { paintZone, zoneAt } from '../build/model.ts'
import { ZONE_LIST, zoneLabel } from '../sim/zones.ts'
import { STOCK_CLASSES } from '../sim/stock.ts'
import type { LineDef, Module, Zone } from '../sim/types.ts'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 有点挤', D: 'D 拥挤', E: 'E 很挤', F: 'F 挤爆' }
// Speed multipliers only: 暂停 lives on the play/pause button, so there is one
// pause control, not a chip that duplicates it.
const SPEEDS = [1, 4, 16]

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
  const restartSim = useStore((s) => s.restartSim)
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
      <button className="primary" onClick={() => setPlaying(!playing)} title="播放 / 暂停（空格）">
        {playing ? '暂停' : '播放'}
      </button>
      <button className="ghost" onClick={restartSim} title="清空所有行人，重新开始（保留车站）">
        重启
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={speed === s ? 'chip on' : 'chip'} onClick={() => setSpeed(s)}>
            {s}×
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

/**
 * Line name + colour. Edits commit on blur / Enter, not per keystroke: every
 * commit rebuilds the worker's station, so typing should not spam it.
 */
function LineFields({ line }: { line: LineDef }): React.ReactElement {
  const updateLine = useStore((s) => s.updateLine)
  const removeLine = useStore((s) => s.removeLine)
  const [name, setName] = useState(line.name)
  const [colour, setColour] = useState(line.colour)
  const [upTerminus, setUpTerminus] = useState(line.upTerminus ?? '')
  const [downTerminus, setDownTerminus] = useState(line.downTerminus ?? '')
  useEffect(() => {
    setName(line.name)
    setColour(line.colour)
    setUpTerminus(line.upTerminus ?? '')
    setDownTerminus(line.downTerminus ?? '')
  }, [line.id, line.name, line.colour, line.upTerminus, line.downTerminus])

  const commitName = (): void => {
    const t = name.trim()
    if (t && t !== line.name) updateLine(line.id, { name: t })
    else setName(line.name)
  }
  const commitColour = (): void => {
    if (colour !== line.colour) updateLine(line.id, { colour })
  }
  // Termini may be cleared to '' (the header then falls back to the direction
  // word), so unlike the name there is no non-empty guard.
  const commitTermini = (): void => {
    const up = upTerminus.trim()
    const down = downTerminus.trim()
    if (up !== (line.upTerminus ?? '') || down !== (line.downTerminus ?? '')) updateLine(line.id, { upTerminus: up, downTerminus: down })
  }
  const terminusKeys = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') {
      setUpTerminus(line.upTerminus ?? '')
      setDownTerminus(line.downTerminus ?? '')
      e.currentTarget.blur()
    }
  }

  return (
    <>
      <div className="row">
        <input
          className="lineNameInput"
          value={name}
          maxLength={16}
          placeholder="线路名"
          title="线路名（回车或点击别处保存）"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setName(line.name)
              e.currentTarget.blur()
            }
          }}
        />
        <input
          type="color"
          className="lineColourInput"
          value={colour}
          title="线路颜色"
          onChange={(e) => setColour(e.target.value)}
          onBlur={commitColour}
        />
        <button
          type="button"
          className="lineDeleteBtn"
          title="删除线路，连同它名下的轨道和屏蔽门"
          aria-label="删除线路"
          onClick={() => removeLine(line.id)}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h12M8 6V4h4v2M6 6l.7 9h6.6L14 6M8.4 9v4M11.6 9v4" />
          </svg>
        </button>
      </div>
      <label className="field">
        <span>上行终点</span>
        <input
          className="lineNameInput"
          value={upTerminus}
          maxLength={12}
          onChange={(e) => setUpTerminus(e.target.value)}
          onBlur={commitTermini}
          onKeyDown={terminusKeys}
        />
      </label>
      <label className="field">
        <span>下行终点</span>
        <input
          className="lineNameInput"
          value={downTerminus}
          maxLength={12}
          onChange={(e) => setDownTerminus(e.target.value)}
          onBlur={commitTermini}
          onKeyDown={terminusKeys}
        />
      </label>
    </>
  )
}

/**
 * A fold for the right-hand inspector: a clickable head and a body that eases
 * open/closed. The body stays mounted (clipped and `inert` while shut), so a
 * collapsed line keeps its half-typed input state.
 */
function Disclosure({
  head,
  open,
  onToggle,
  className,
  children,
}: {
  head: React.ReactNode
  open: boolean
  onToggle: () => void
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={className ? `disclosure ${className}` : 'disclosure'}>
      <button type="button" className={open ? 'disclosureHead open' : 'disclosureHead'} onClick={onToggle} aria-expanded={open}>
        {head}
        <span className="disclosureCaret" aria-hidden="true" />
      </button>
      <div className={open ? 'foldBody open' : 'foldBody'} aria-hidden={!open} inert={!open}>
        <div className="foldInner">{children}</div>
      </div>
    </div>
  )
}

/**
 * One exit's card in 出入口客流: its name (editable — the 3D header reprints on
 * commit), its demand and its open toggle. The card is the RHS half of the
 * selection link: it highlights when this exit is the 3D selection, and clicking
 * or focusing any control selects the exit so the 3D box follows.
 */
function ExitCard({ mod }: { mod: Extract<Module, { type: 'exit' }> }): React.ReactElement {
  const station = useStore((s) => s.station)
  const commit = useStore((s) => s.commit)
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const [name, setName] = useState(mod.cfg.name)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setName(mod.cfg.name), [mod.id, mod.cfg.name])

  const isSelected = selected?.kind === 'module' && selected.key === mod.id
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [isSelected])

  const patch = (p: Partial<{ name: string; inRate: number; open: boolean }>): void => {
    const modules = station.modules.map((m) => (m.id === mod.id && m.type === 'exit' ? { ...m, cfg: { ...m.cfg, ...p } } : m))
    commit({ ...station, modules })
  }
  const commitName = (): void => {
    const t = name.trim()
    if (t && t !== mod.cfg.name) patch({ name: t })
    else setName(mod.cfg.name)
  }
  const pick = (): void => select({ kind: 'module', key: mod.id, label: moduleLabel('exit') })

  return (
    <div ref={ref} className={isSelected ? 'card sel' : 'card'} onClick={pick} onFocus={pick}>
      <label className="field">
        <span>名称</span>
        <input
          className="lineNameInput"
          value={name}
          maxLength={12}
          placeholder="出入口名"
          title="出入口名称（回车或点击别处保存）"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setName(mod.cfg.name)
              e.currentTarget.blur()
            }
          }}
        />
      </label>
      <label className="field">
        <span>进站 {mod.cfg.inRate} 人/时</span>
        <input type="range" min={0} max={6000} step={10} value={mod.cfg.inRate} onChange={(e) => patch({ inRate: Number(e.target.value) })} />
      </label>
      <label className="field inline">
        <input type="checkbox" checked={mod.cfg.open} onChange={(e) => patch({ open: e.target.checked })} />
        <span>开放</span>
      </label>
    </div>
  )
}

function Inspector(): React.ReactElement {
  const station = useStore((s) => s.station)
  const selected = useStore((s) => s.selected)
  const updateLine = useStore((s) => s.updateLine)
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
          </div>
        ) : (
          <div className="muted small">点一下方块或设备，就能选中。</div>
        )}
        {selected?.kind === 'cell' && <ZoneCard />}
      </Folder>

      <Folder title="出入口" count={exits.length} open={exitsOpen} onToggle={() => setExitsOpen((v) => !v)}>
        {exits.length === 0 && <div className="muted small">还没建出入口。</div>}
        {exits.map((m) => (m.type === 'exit' ? <ExitCard key={m.id} mod={m} /> : null))}
      </Folder>

      <Folder title="线路" count={station.lines.length} open={linesOpen} onToggle={() => setLinesOpen((v) => !v)}>
        {station.lines.length === 0 && (
          <div className="muted small">还没配线路。铺下第一段轨道时会自动新建，也可以在这里手动加。</div>
        )}
        {station.lines.map((line) => {
          const open = openLines[line.id] ?? true
          // The slider is per car; the readout is the whole train. So the shown
          // 载客量 is a function of both 编组 and the per-car load, and 人/时 folds
          // in the peak headway.
          const perCar = Math.max(0, Math.round(line.alightPerTrain / Math.max(1, line.cars)))
          const perHour = Math.round((line.alightPerTrain * 3600) / line.headwayProfile.peak)
          return (
            <Disclosure
              key={line.id}
              className="card"
              head={
                <span className="kv">
                  <b>
                    <i className="swatch" style={{ background: line.colour }} /> {line.name} · {line.stock}型{line.cars}节
                  </b>
                </span>
              }
              open={open}
              onToggle={() => setOpenLines((o) => ({ ...o, [line.id]: !(o[line.id] ?? true) }))}
            >
              <LineFields line={line} />
              <div className="row">
                <span className="muted small">车型</span>
                {STOCK_CLASSES.map((s) => (
                  <button key={s} className={line.stock === s ? 'chip on' : 'chip'} onClick={() => updateLine(line.id, { stock: s })}>
                    {s}型
                  </button>
                ))}
              </div>
              <label className="field">
                <span>编组 {line.cars} 节</span>
                <input type="range" min={1} max={8} step={1} value={line.cars} onChange={(e) => updateLine(line.id, { cars: Number(e.target.value) })} />
              </label>
              <div className="row">
                <span className="muted small">供电</span>
                {(['third-rail', 'catenary'] as const).map((p) => (
                  <button
                    key={p}
                    className={line.power === p ? 'chip on' : 'chip'}
                    onClick={() => updateLine(line.id, { power: p })}
                  >
                    {p === 'third-rail' ? '第三轨' : '接触网'}
                  </button>
                ))}
              </div>
              <div className="row">
                <span className="muted small">屏蔽门</span>
                {(['full', 'half'] as const).map((p) => (
                  <button
                    key={p}
                    className={(line.psd ?? 'full') === p ? 'chip on' : 'chip'}
                    title={p === 'full' ? '全高屏蔽门：整层高的玻璃，顶部印刷线路信息' : '半高屏蔽门：1.5m 高，线路信息贴在玻璃上'}
                    onClick={() => updateLine(line.id, { psd: p })}
                  >
                    {p === 'full' ? '全高' : '半高'}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>
                  {line.alightPerTrain} 人/列 · {perHour.toLocaleString()} 人/时
                </span>
                <input
                  type="range"
                  min={0}
                  max={400}
                  step={10}
                  value={perCar}
                  title={`每节 ${perCar} 人`}
                  onChange={(e) => updateLine(line.id, { alightPerTrain: Number(e.target.value) * line.cars })}
                />
              </label>
            </Disclosure>
          )
        })}
        <button className="chip" onClick={addLine}>
          + 新建线路
        </button>
      </Folder>
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
  const autoWalls = useStore((s) => s.autoWalls)
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
        case ' ':
          // Space is the play/pause key. Always stop the default (page scroll or
          // activating a focused button); a focused button would otherwise toggle
          // twice, so it does not also pause.
          e.preventDefault()
          if (tag !== 'BUTTON') st.setPlaying(!st.playing)
          break
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
          if (e.ctrlKey || e.metaKey || e.altKey) break
          if (st.tool === 'rail') st.rotateRail()
          else if (st.tool !== 'tunnel' && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          e.preventDefault()
          if (st.tool === 'rail') st.cycleRailDir()
          else if (isStairType(st.moduleType)) st.cycleStairWidth()
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
        case 'g':
          st.setTool('rail')
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
              ? autoWalls
                ? '地基：单击放一块，按住拖出一片（自动长出 4m 外墙），右键删除'
                : '地基：单击放一块，按住拖出一片（自动生成墙壁已关，只铺地砖），右键删除'
              : tool === 'wall'
                ? '墙：按住拖出一条 4m 高的墙；右键拖拽整列拆除'
                : tool === 'delete'
                  ? '删除：单击拆一块，按住拖出一条拆一行（左右键都一样）'
                  : tool === 'module'
                ? isFenceType(moduleType)
                  ? '围栏：单击放一块（R 旋转），按住拖出一条（方向跟拖拽走），右键拆掉；连上闸机就能分区'
                  : isStairType(moduleType)
                  ? '楼梯：点地面放下，能转方向、调宽度，右键拆掉'
                  : isEscalatorType(moduleType)
                    ? '扶梯：点地面放下，能转方向、切上下行，右键拆掉'
                    : moduleType === 'lift'
                      ? '电梯：点地面放 2×2 米井道（跨两层，R 转门向）；对着井道上半截悬停向上加层，下半截向下加层，右键拆掉'
                    : isDecorType(moduleType)
                      ? moduleType === 'shelf'
                        ? '货架：点地面放下，能转方向，右键逐个拆掉'
                        : moduleType === 'desk'
                          ? '办公桌：点地面放下，能转方向，右键逐个拆掉'
                          : moduleType === 'cubicle'
                            ? '厕所隔间：点地面放下，能转方向，右键逐个拆掉'
                            : moduleType === 'sink'
                              ? '洗手池：点地面放下，能转方向，右键逐个拆掉'
                              : isWallMountedType(moduleType)
                                ? '广告牌：点地面贴在墙上（R 转方向让背面朝墙），右键拆掉'
                                : moduleType === 'sign' || moduleType === 'tv'
                                  ? '指示牌/电视：吊在天花板下（上面要有四米高的楼板），R 转方向，右键拆掉'
                                  : '座椅：点地面放下（不锈钢无靠背 / 带靠背连排，各 1m 与 2m），能转方向，右键拆掉'
                      : '设备：左边选一种，点地面放下，能转方向，右键拆掉'
                : tool === 'paint'
                  ? '材质：左键刷一格，拖拽刷一片，右键还原，取色能吸'
                  : tool === 'zone'
                    ? '分区：左键点或拖框上色；房间/售票亭拖框建，墙上右键开门'
                    : tool === 'rail'
                      ? '站台轨道：点地面放一段列车长度的轨道床（R 旋转，Tab 切换上下行），自动生成站台门'
                      : tool === 'tunnel'
                        ? '隧道：点已有轨道，从端头接一段隧道；滑杆调长度'
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
