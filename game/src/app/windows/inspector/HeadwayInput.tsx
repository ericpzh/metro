import { t } from '../../../sim/i18n.ts'
import { splitHeadway } from '../../../sim/headway.ts'
import { useLanguage } from '../../i18n.ts'
import { useEffect, useState } from 'react'

/**
 * One headway row: the 分 / 秒 pair the timetable runs on (§6.5). Drafts stay
 * local and commit on blur / Enter — every commit rebuilds the worker's
 * station, so typing must not spam it (the same contract `LineFields` keeps).
 */
export function HeadwayInput({
  label,
  seconds,
  onCommit,
}: {
  label: string
  seconds: number
  onCommit: (seconds: number) => void
}): React.ReactElement {
  useLanguage()
  const split = splitHeadway(seconds)
  const [minutes, setMinutes] = useState(String(split.minutes))
  const [secs, setSecs] = useState(String(split.seconds))
  useEffect(() => {
    const next = splitHeadway(seconds)
    setMinutes(String(next.minutes))
    setSecs(String(next.seconds))
  }, [seconds])

  const commit = (): void => {
    const m = Math.max(0, Math.min(20, Math.floor(Number(minutes) || 0)))
    const s = Math.max(0, Math.min(59, Math.floor(Number(secs) || 0)))
    const total = Math.max(60, Math.min(1200, m * 60 + s))
    const current = splitHeadway(seconds)
    if (total !== current.minutes * 60 + current.seconds) onCommit(total)
    else {
      setMinutes(String(current.minutes))
      setSecs(String(current.seconds))
    }
  }
  const keys = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') {
      const current = splitHeadway(seconds)
      setMinutes(String(current.minutes))
      setSecs(String(current.seconds))
      e.currentTarget.blur()
    }
  }

  return (
    <div className="row">
      <span className="muted small">{label}</span>
      <input
        type="number"
        className="lineNameInput headwayNum"
        style={{ width: 52 }}
        min={0}
        max={20}
        step={1}
        value={minutes}
        aria-label={`${label}${t('minutes_short')}`}
        onChange={(e) => setMinutes(e.target.value)}
        onBlur={commit}
        onKeyDown={keys}
      />
      <span className="muted small">{t('minutes_short')}</span>
      <input
        type="number"
        className="lineNameInput headwayNum"
        style={{ width: 52 }}
        min={0}
        max={59}
        step={5}
        value={secs}
        aria-label={`${label}${t('seconds_short')}`}
        onChange={(e) => setSecs(e.target.value)}
        onBlur={commit}
        onKeyDown={keys}
      />
      <span className="muted small">{t('seconds_short')}</span>
    </div>
  )
}
