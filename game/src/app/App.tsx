import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, isEscalatorType, isGateType, isRotatableType, isStairType, moduleLabel } from './store.ts'
import { isMovableModule } from '../sim/placement.ts'
import { Folder, LeftRail } from './LeftRail.tsx'
import { Viewport } from './Viewport.tsx'
import { SignEditor } from './SignEditor.tsx'
import { paintZone, zoneAt } from '../build/model.ts'
import { ZONE_LIST, zoneLabel } from '../sim/zones.ts'
import { STOCK_CLASSES } from '../sim/stock.ts'
import type { LineDef, Module, Zone } from '../sim/types.ts'

const LOS_LABEL: Record<string, string> = { A: 'A 畅通', B: 'B 顺畅', C: 'C 有点挤', D: 'D 拥挤', E: 'E 很挤', F: 'F 挤爆' }
// Speed multipliers: the play/pause toggle and the speeds are one segmented
// group of four (暂停 | 1× | 4× | 16×). Exactly one is highlighted: paused ⇒
// the pause icon, playing ⇒ the active speed. Clicking a speed resumes at
// that speed; Space toggles between paused and the last selected speed.
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
  // Ctrl+L opens the file picker, but the input lives here while the key
  // handler lives in App, so it arrives as an event.
  useEffect(() => {
    const open = (): void => fileRef.current?.click()
    window.addEventListener('metro:open', open)
    return () => window.removeEventListener('metro:open', open)
  }, [])
  const playAt = (s: number): void => {
    if (speed !== s) setSpeed(s)
    if (!playing) setPlaying(true)
  }
  return (
    <div className="topbar">
      <div className="brand">
        <span className="logo">地铁站设计师</span>
        <StationName />
      </div>
      <div className="spacer" />
      <button className="ghost iconBtn" onClick={newStation} title="新建 (Ctrl+N)" aria-label="新建">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 1.5h5l3 3V14.5H4z" />
          <path d="M9 1.5v3h3" />
          <path d="M8 8.5v4M6 10.5h4" />
        </svg>
      </button>
      <button className="ghost iconBtn" onClick={loadReference} title="打开示例车站 (Ctrl+Shift+N)" aria-label="示例车站">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 6 8 2l6.5 4" />
          <path d="M3.5 6v6.5M12.5 6v6.5M6.2 6v6.5M9.8 6v6.5M1.5 12.5h13" />
        </svg>
      </button>
      <button className="ghost iconBtn" onClick={saveToFile} title="保存到文件 (Ctrl+S)" aria-label="保存">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 2h8l2 2v10H3z" />
          <path d="M5 2v3.5h6V2" />
          <rect x="5" y="9" width="6" height="5" />
        </svg>
      </button>
      <button className="ghost iconBtn" onClick={() => fileRef.current?.click()} title="从文件打开 (Ctrl+L)" aria-label="打开">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 4.5h4.5L7.2 6H14.5v6.5h-13z" />
        </svg>
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
      <div className="seg" role="group" aria-label="播放控制">
        <button
          className={!playing ? 'on' : ''}
          onClick={() => {
            if (playing) setPlaying(false)
          }}
          title="暂停（空格）"
          aria-label="暂停"
          aria-pressed={!playing}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="3.5" y="3" width="3" height="10" rx="0.6" />
              <rect x="9.5" y="3" width="3" height="10" rx="0.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13.2 8z" />
            </svg>
          )}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={playing && speed === s ? 'on' : ''}
            onClick={() => playAt(s)}
            title={`${s} 倍速`}
            aria-label={`${s} 倍速`}
            aria-pressed={playing && speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
      <button className="ghost iconBtn" onClick={restartSim} title="清空所有行人 (Ctrl+R)" aria-label="重启">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 1.8v3h-3" />
        </svg>
      </button>
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
  const moveDraft = useStore((s) => s.moveDraft)
  const updateLine = useStore((s) => s.updateLine)
  const addLine = useStore((s) => s.addLine)
  const openSignEditor = useStore((s) => s.openSignEditor)
  const [infoOpen, setInfoOpen] = useState(true)
  const [linesOpen, setLinesOpen] = useState(true)
  const [exitsOpen, setExitsOpen] = useState(true)
  // Per-line fold state. A line with no entry reads as open, so a freshly added
  // line starts expanded without seeding the map.
  const [openLines, setOpenLines] = useState<Record<string, boolean>>({})

  const exits = useMemo(() => station.modules.filter((m) => m.type === 'exit'), [station.modules])
  // The selected piece, when the selection is a placed module — what 移动 acts on.
  const selectedModule = selected?.kind === 'module' ? station.modules.find((m) => m.id === selected.key) : undefined
  const isSign = selectedModule?.type === 'sign'
  const movable = selectedModule !== undefined && isMovableModule(selectedModule)
  // The lift's own controls take the card over the moment a piece is in the air, so
  // they are read from the lift rather than from the selection: whatever is selected,
  // 确认 / 取消 are always where the 移动 button was.
  const canDrop = moveDraft !== null && moveDraft.at !== null && moveDraft.candidate !== null && moveDraft.reason === ''

  return (
    <div className="panel">
      <div className="railStamp">
        <span className="railStampTitle">信息栏</span>
        <span className="railStampSub">METRO / INSPECTOR</span>
      </div>

      <Folder title="信息" open={infoOpen} onToggle={() => setInfoOpen((v) => !v)}>
        {selected ? (
          <div className="card">
            {moveDraft ? (
              // 移动 (§9.5): while a piece is in the air this card **is** the move's
              // control surface — the same place the 移动 button was pressed, so
              // there is nothing to look for anywhere else. The 3D view shows the
              // translucent ghost under the pointer; here is where it is, whether it
              // will land, and the two ways out of it.
              <>
                <div className="kv" title="R 旋转；在地面左键放下；Esc / 右键放回原位">
                  <span>移动</span>
                  <b>{moduleLabel(moveDraft.module.type, moveDraft.module.type === 'shop' ? moveDraft.module.cfg.kind : undefined)}</b>
                </div>
                <div className="kv">
                  <span>位置</span>
                  <b className={canDrop ? undefined : 'bad'}>
                    {moveDraft.at ? `(${moveDraft.at.x}, ${moveDraft.at.y}, ${moveDraft.at.z})` : '移到要放的位置'}
                  </b>
                </div>
                {moveDraft.reason !== '' && <div className="moveReason small">{moveDraft.reason}</div>}
                <div className="row">
                  <button
                    className="chip primary"
                    disabled={!canDrop}
                    title="确认：把它放在这里（也可以直接在地面点一下，或按 Enter）"
                    onClick={() => useStore.getState().confirmMove()}
                  >
                    确认
                  </button>
                  <button
                    className="chip"
                    title="取消：放回拿起来的地方（Esc、右键也一样）"
                    onClick={() => useStore.getState().cancelMove()}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="kv">
                  <span>已选</span>
                  <b>{selected.label}</b>
                </div>
                <div className="kv">
                  <span>类型</span>
                  <b>{selected.kind === 'module' ? '设备' : '方块'}</b>
                </div>
                <div className="row">
                  {/* 移动 lives here rather than on a tile: the piece is already
                      selected, so the card is where "move this one" belongs. Pressing
                      it lifts the piece in the 3D view and turns this card into the
                      move's own controls (above); a structure that cannot be moved
                      says why and stays disabled. */}
                  {selected.kind === 'module' && (
                    <button
                      className="chip primary"
                      disabled={!movable}
                      title={
                        movable
                          ? '移动：把它拿起来换个位置。整件东西原样移过去——指示牌印的面板、闸机的门向、广告牌的画面都不变；Esc / 右键随时放回原位'
                          : `${selected.label}不能移动：用删除 (B) 拆掉再放`
                      }
                      onClick={() => useStore.getState().liftModule(selected.key)}
                    >
                      移动
                    </button>
                  )}
                  {/* A 指示牌 is composed on its own board (§5.8), so it is edited in
                      the board editor rather than in a property list here. */}
                  {isSign && (
                    <button className="chip" onClick={() => openSignEditor(selected.key)}>
                      编辑指示牌面板
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="muted small">暂未选中任何物品。</div>
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
      // While the 指示牌 board editor is up it owns the keyboard: Space, R, Tab and
      // Delete all mean something to the board being composed, not to the station
      // behind it. Its own Delete binding lives on the board (SignEditor).
      if (st.signEditorFor !== null || st.signComposing) return
      // Ctrl shortcuts for the top-bar icon actions (shown in their tooltips).
      // Handled before the single-letter tool keys so Ctrl+N never also grabs
      // the 材质 brush, etc.
      const ck = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (ck === 's') {
          e.preventDefault()
          st.saveToFile()
          return
        }
        if (ck === 'n' && e.shiftKey) {
          e.preventDefault()
          st.loadReference()
          return
        }
        if (ck === 'n') {
          e.preventDefault()
          st.newStation()
          return
        }
        if (ck === 'l') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('metro:open'))
          return
        }
        if (ck === 'r') {
          e.preventDefault()
          st.restartSim()
          return
        }
        // Undo/redo keep their bindings in the switch below; every other
        // Ctrl/⌘+letter is ignored here.
        if (ck !== 'z' && ck !== 'y') return
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          // Space is the play/pause key. A focused button would also fire on
          // keyup (native Space-activates-button), so drop focus on keydown —
          // the keyup then lands on the body and cannot re-click it — and
          // always toggle. Otherwise Space right after clicking 4× would just
          // re-press 4× instead of pausing.
          e.preventDefault()
          if (tag === 'BUTTON') (e.target as HTMLElement).blur()
          st.setPlaying(!st.playing)
          break
        case 'v':
          setTool('select' as const)
          break
        case 'b':
          st.setTool('delete')
          break
        case 'f':
          st.setTool('block')
          break
        case 'g':
          st.setTool('wall')
          break
        case 'j':
          st.setTool('module')
          break
        case 'r':
          if (e.ctrlKey || e.metaKey || e.altKey) break
          // A piece in the air (移动) is what R turns, whatever tool is active: the
          // 信息 card lifted it, so there is no move tool to ask.
          if (st.moveDraft) st.rotateMove()
          // The 墙 tool has no piece to turn: R picks which of a corner cell's
          // wall faces the column takes (`wallSnap` in `build/model.ts`).
          else if (st.tool === 'wall') st.rotateWallSnap()
          else if (st.tool === 'rail') st.rotateRail()
          else if (st.tool !== 'tunnel' && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          // In the 地基 tool Tab flips 自动生成墙壁; everywhere else it keeps its
          // own meaning for the piece being placed: rail direction, stair width,
          // escalator direction, the 闸机's lane or fence.
          e.preventDefault()
          if (st.tool === 'block') st.setAutoWalls(!st.autoWalls)
          else if (st.tool === 'rail') st.cycleRailDir()
          else if (isStairType(st.moduleType)) st.cycleStairWidth()
          else if (isEscalatorType(st.moduleType)) st.cycleEscalatorDir()
          else if (isGateType(st.moduleType)) st.cycleGateDoor()
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
        case 'h':
          st.setAutoCeiling(!st.autoCeiling)
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
        case 'home':
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
            // Z is the 选择 tool now; 分区 moved to P.
            st.setTool('select')
          }
          break
        case 'p':
          st.setTool('zone')
          break
        case 'l':
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
        </div>
        <Inspector />
      </div>
      <BottomBar />
      {notice && (
        <div className="toast" onClick={() => useStore.getState().setNotice(null)}>
          {notice}
        </div>
      )}
      {/* The 指示牌 board editor is a modal over everything, so the board is as big
          as the window will allow. */}
      <SignEditor />
    </div>
  )
}
