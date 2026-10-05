// Lane A split (Phase 1): moved verbatim from app/App.tsx — one card per line
// (plan.md R3). The per-line fold (Disclosure + LineFields + rolling-stock /
// power / 屏蔽门 / load controls) previously lived inline in Inspector()'s
// 线路 folder; it now lives with its item so the list file only maps.
import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { STOCK_CLASSES } from '../../../sim/stock.ts'
import type { LineDef } from '../../../sim/types.ts'
import { Disclosure } from '../shared/Disclosure.tsx'

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

export function LineCard({ line, open, onToggle }: { line: LineDef; open: boolean; onToggle: () => void }): React.ReactElement {
  const updateLine = useStore((s) => s.updateLine)
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
      onToggle={onToggle}
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
}
