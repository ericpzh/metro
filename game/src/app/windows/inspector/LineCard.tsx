import { Slider } from '../../Slider.tsx'
import { msg, translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// Lane A split (Phase 1): moved verbatim from app/App.tsx — one card per line
// (plan.md R3). The per-line fold (Disclosure + LineFields + rolling-stock /
// power / 屏蔽门 / load controls) previously lived inline in Inspector()'s
// 线路 folder; it now lives with its item so the list file only maps.
import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { FORMATION_OPTIONS, servedPerHour, trainsPerHour } from '../../../sim/headway.ts'
import { STOCK_CLASSES } from '../../../sim/stock.ts'
import type { LineDef } from '../../../sim/types.ts'
import { Disclosure } from '../shared/Disclosure.tsx'
import { HeadwayInput } from './HeadwayInput.tsx'

/**
 * Line name + colour. Edits commit on blur / Enter, not per keystroke: every
 * commit is one undo step; drafts remain local while typing.
 */
function LineFields({ line }: { line: LineDef }): React.ReactElement {
  useLanguage()
  const updateLine = useStore((s) => s.updateLine)
  const removeLine = useStore((s) => s.removeLine)
  const [name, setName] = useState(line.name)
  const [colour, setColour] = useState(line.colour)
  const [upTerminus, setUpTerminus] = useState(line.upTerminus ?? '')
  const [upTerminusEn, setUpTerminusEn] = useState(line.upTerminusEn ?? '')
  const [downTerminus, setDownTerminus] = useState(line.downTerminus ?? '')
  const [downTerminusEn, setDownTerminusEn] = useState(line.downTerminusEn ?? '')
  useEffect(() => {
    setName(line.name)
    setColour(line.colour)
    setUpTerminus(line.upTerminus ?? '')
    setUpTerminusEn(line.upTerminusEn ?? '')
    setDownTerminus(line.downTerminus ?? '')
    setDownTerminusEn(line.downTerminusEn ?? '')
  }, [line.id, line.name, line.colour, line.upTerminus, line.downTerminus, line.upTerminusEn, line.downTerminusEn])

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
    const upEn = upTerminusEn.trim(), downEn = downTerminusEn.trim()
    if (up !== (line.upTerminus ?? '') || down !== (line.downTerminus ?? '') || upEn !== (line.upTerminusEn ?? '') || downEn !== (line.downTerminusEn ?? '')) {
      updateLine(line.id, { upTerminus: up, downTerminus: down, upTerminusEn: upEn, downTerminusEn: downEn })
    }
  }
  const terminusKeys = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') {
      setUpTerminus(line.upTerminus ?? '')
      setUpTerminusEn(line.upTerminusEn ?? '')
      setDownTerminus(line.downTerminus ?? '')
      setDownTerminusEn(line.downTerminusEn ?? '')
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
          placeholder={t('line_name')}
          aria-label={t('line_name')}
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
          aria-label={t('line_colour')}
          onChange={(e) => setColour(e.target.value)}
          onBlur={commitColour}
        />
        <button
          type="button"
          className="lineDeleteBtn"
          aria-label={t('delete_line')}
          onClick={() => removeLine(line.id)}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h12M8 6V4h4v2M6 6l.7 9h6.6L14 6M8.4 9v4M11.6 9v4" />
          </svg>
        </button>
      </div>
      <div className="lineTermini">
        {(['up', 'down'] as const).map((direction) => (
          <div className="lineTile lineTerminus" key={direction}>
            <span className="muted small">{t(direction === 'up' ? 'up_terminus' : 'down_terminus')}</span>
            <input className="lineNameInput" value={direction === 'up' ? upTerminus : downTerminus}
              maxLength={12} placeholder={t('primary_sign_text')}
              aria-label={`${t(direction === 'up' ? 'up_terminus' : 'down_terminus')} · ${t('primary_sign_text')}`}
              onChange={(e) => (direction === 'up' ? setUpTerminus : setDownTerminus)(e.target.value)}
              onBlur={commitTermini} onKeyDown={terminusKeys} />
            <input className="lineNameInput" value={direction === 'up' ? upTerminusEn : downTerminusEn}
              maxLength={48} placeholder={t('secondary_sign_text')} lang="en"
              aria-label={`${t(direction === 'up' ? 'up_terminus' : 'down_terminus')} · ${t('secondary_sign_text')}`}
              onChange={(e) => (direction === 'up' ? setUpTerminusEn : setDownTerminusEn)(e.target.value)}
              onBlur={commitTermini} onKeyDown={terminusKeys} />
          </div>
        ))}
      </div>
    </>
  )
}

export function LineCard({ line, open, onToggle }: { line: LineDef; open: boolean; onToggle: () => void }): React.ReactElement {
  useLanguage()
  const updateLine = useStore((s) => s.updateLine)
  // The load slider is per car; the readout is the whole train. So the shown
  // 载客量 is a function of both 编组 and the per-car load, and each headway
  // row folds its own interval into 人/时 below.
  const perCar = Math.max(0, Math.round(line.alightPerTrain / Math.max(1, line.cars)))
  const peakServed = servedPerHour(line.alightPerTrain, line.headwayProfile.peak)
  const offpeakServed = servedPerHour(line.alightPerTrain, line.headwayProfile.offpeak)
  const lateServed = servedPerHour(line.alightPerTrain, line.headwayProfile.late)
  return (
    <Disclosure
      key={line.id}
      className="card lineCard"
      tutorialId={`line-${line.id}`}
      head={
        <span className="kv">
          <b>
            <i className="swatch" style={{ background: line.colour }} /> {line.name} · {t('train_formation', line.stock, line.cars)}</b>
        </span>
      }
      open={open}
      onToggle={onToggle}
    >
      <div className="lineEditor">
      <LineFields line={line} />
      <div className="row lineTile lineOptions">
        <span className="muted small">{t('train_type')}</span>
        {STOCK_CLASSES.map((s) => (
          <button key={s} className={line.stock === s ? 'chip on' : 'chip'} onClick={() => updateLine(line.id, { stock: s })}>
            {s}</button>
        ))}
      </div>
      <div className="row lineTile lineOptions">
        <span className="muted small">{t('formation')}</span>
        {FORMATION_OPTIONS.map((n) => (
          <button key={n} className={line.cars === n ? 'chip on' : 'chip'} onClick={() => updateLine(line.id, { cars: n })}>
            {translate(n)}</button>
        ))}
      </div>
      <div className="lineTile lineSchedule">
      <HeadwayInput
        label={t('peak_headway')}
        seconds={line.headwayProfile.peak}
        onCommit={(peak) => updateLine(line.id, { headwayProfile: { ...line.headwayProfile, peak } })}
      />
      <div className="row">
        <span className="muted small">{translate(trainsPerHour(line.headwayProfile.peak))} {t('trains_h')} · {translate(peakServed.toLocaleString())} {t('people_h')}</span>
      </div>
      </div>
      <div className="lineTile lineSchedule">
      <HeadwayInput
        label={t('offpeak_headway')}
        seconds={line.headwayProfile.offpeak}
        onCommit={(offpeak) => updateLine(line.id, { headwayProfile: { ...line.headwayProfile, offpeak } })}
      />
      <div className="row">
        <span className="muted small">{translate(trainsPerHour(line.headwayProfile.offpeak))} {t('trains_h')} · {translate(offpeakServed.toLocaleString())} {t('people_h')}</span>
      </div>
      </div>
      <div className="lineTile lineSchedule">
      <HeadwayInput
        label={t('late_headway')}
        seconds={line.headwayProfile.late}
        onCommit={(late) => updateLine(line.id, { headwayProfile: { ...line.headwayProfile, late } })}
      />
      <div className="row">
        <span className="muted small">{translate(trainsPerHour(line.headwayProfile.late))} {t('trains_h')} · {translate(lateServed.toLocaleString())} {t('people_h')}</span>
      </div>
      </div>
      <div className="row lineTile lineOptions">
        <span className="muted small">{t('power')}</span>
        {(['third-rail', 'catenary'] as const).map((p) => (
          <button
            key={p}
            className={line.power === p ? 'chip on' : 'chip'}
            onClick={() => updateLine(line.id, { power: p })}
          >
            {translate(p === 'third-rail' ? msg('third_rail') : msg('overhead_wire'))}
          </button>
        ))}
      </div>
      <div className="row lineTile lineOptions">
        <span className="muted small">{t('screen_doors')}</span>
        {(['full', 'half', 'none'] as const).map((p) => (
          <button
            key={p}
            className={(line.psd ?? 'full') === p ? 'chip on' : 'chip'}
            onClick={() => updateLine(line.id, { psd: p })}
          >
            {translate(p === 'full' ? msg('full_height') : p === 'half' ? msg('half_height') : msg('screen_doors_none'))}
          </button>
        ))}
      </div>
      <label className="field">
        <span>
          {translate(line.alightPerTrain)} {' '}{t('people_train')}</span>
        <Slider
          min={0}
          max={400}
          step={10}
          value={perCar}
          aria-label={t('capacity_per_car')}
          onChange={(e) => updateLine(line.id, { alightPerTrain: Number(e.target.value) * line.cars })}
        />
      </label>
      </div>
    </Disclosure>
  )
}
