// The floating **时刻** window (§9.6C 时刻 / 客流输入, sheet 06's panels A, B and D): what the
// 信息栏's clock card opens when it is pressed.
//
// It is the day itself, in three blocks and a strip:
//
//   A. the **curve** (`DayCurve`) — the station's demand over 24 hours, the operating hours
//      lit, the peaks shaded, now marked — drawn from `sim/demand.ts`, the module the spawn
//      draws its arrivals from;
//   B. the **calendar** — the date, the weekday and the day type with each type's calendar
//      coefficient, which is §7.4's `calendar(dayOfYear)` factor;
//   D. the **settings** — 营业时间, 早高峰 / 晚高峰 and the three 客流曲线 knobs, all of them
//      station document data, so each edit is an undoable change the sim rebuilds from;
//   and a strip of the metrics that are about time — population, the day's counters, the
//      queues and the worst level of service.
//
// **A slider is a draft until the pointer lets go.** Dragging writes only local state, so
// the curve redraws under the hand; the document is committed on release (or on the
// keyboard's own keyup, or on blur). Committing per input event would push an undo frame —
// and a worker rebuild — for every pixel of a drag.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store.ts'
import { LOS_LABELS } from '../../../sim/constants.ts'
import {
  DEFAULT_CALENDAR,
  DAY_TYPE_LABELS,
  PERIOD_LABELS,
  clockTextOf,
  secondsOfClock,
  stampAt,
} from '../../../sim/clock.ts'
import { DAY_TYPE_FACTOR, DEMAND_AM_HOUR, DEMAND_LIMITS, DEMAND_PM_HOUR, demandRate, type DemandInput, type DemandKnobs } from '../../../sim/demand.ts'
import { DayCurve, DayCurveLegend } from './DayCurve.tsx'

/** The four day types, in the order the spec's dropdown lists them (§9.6C 日期类型). */
const DAY_TYPES = ['weekday', 'saturday', 'sunday', 'holiday'] as const

/** A `HH:MM` box that commits one end of a span and leaves the other alone. */
function TimeBox({ label, seconds, onCommit }: { label: string; seconds: number; onCommit: (s: number) => void }): React.ReactElement {
  return (
    <input
      className="timeBox"
      type="time"
      step={60}
      value={clockTextOf(seconds)}
      aria-label={label}
      // An empty or half-typed box changes nothing: `<input type="time">` reports `''`
      // while the player is still in it, and the span must not jump to midnight in between.
      onChange={(e) => {
        const s = secondsOfClock(e.target.value)
        if (s !== null) onCommit(s)
      }}
    />
  )
}

/** One knob: a slider in per-cent, its value, and the draft/commit rule. */
function Knob({
  label,
  hint,
  value,
  min,
  max,
  onDraft,
  onCommit,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  onDraft: (v: number) => void
  onCommit: () => void
}): React.ReactElement {
  return (
    <label className="knob">
      <span className="knobHead">
        <span className="knobLabel">{label}</span>
        <b className="knobValue">{Math.round(value * 100)}%</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        aria-label={label}
        onChange={(e) => onDraft(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <span className="knobHint">{hint}</span>
    </label>
  )
}

export function TimePanel(): React.ReactElement | null {
  const open = useStore((s) => s.timePanel)
  const setTimePanel = useStore((s) => s.setTimePanel)
  const simTime = useStore((s) => s.metrics?.simTime ?? null)
  const metrics = useStore((s) => s.metrics)
  const playing = useStore((s) => s.playing)
  const station = useStore((s) => s.station)
  const setServiceWindow = useStore((s) => s.setServiceWindow)
  const setPeakWindow = useStore((s) => s.setPeakWindow)
  const setDemandKnobs = useStore((s) => s.setDemandKnobs)
  const [draft, setDraft] = useState<DemandKnobs | null>(null)

  // Escape closes it, the way it backs out of every other gesture in the game. The
  // viewport's own key handler also reads Escape (it cancels a 吸取, a 移动 and an
  // active drag), so one press can both close this window and back out of whatever
  // gesture was armed behind it — which is what Escape means in both places, and why
  // the window does not swallow the key.
  //
  // Closing **discards an uncommitted slider draft**: a drag the player never let go of is
  // a gesture they walked away from, exactly as Escape throws away every other one. Without
  // this the draft would still be sitting there when the window reopened, showing a day the
  // sim is not running.
  useEffect(() => {
    if (!open) {
      setDraft(null)
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTimePanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setTimePanel])

  const knobs = draft ?? station.demand
  const input: DemandInput = useMemo(
    () => ({ service: station.service, peaks: station.peaks, knobs }),
    [station.service, station.peaks, knobs],
  )
  const stamp = simTime === null ? null : stampAt(simTime, DEFAULT_CALENDAR, station.service, station.peaks)

  /**
   * Let go of a slider: the draft becomes the document. A keystroke that repaired to what
   * is already stored is not an edit and `setDemandKnobs` says so, so this cannot push an
   * empty undo frame.
   */
  const commitDraft = (): void => {
    if (draft === null) return
    setDemandKnobs(draft)
    setDraft(null)
  }

  if (!open) return null

  // What the station will actually take in over an hour at this instant: the exits'
  // configured in-rates (an exit switched off contributes nothing) times the curve the
  // plot is drawing. Zero exits is a legitimate answer — the 出入口 folder is where they
  // are set — so the strip prints 0/小时 rather than hiding the block.
  const totalInRate = station.modules.reduce((n, m) => (m.type === 'exit' && m.cfg.open !== false ? n + (m.cfg.inRate ?? 0) : n), 0)
  const perHour = stamp === null ? 0 : Math.round(totalInRate * demandRate(stamp.simTime, stamp.dayType, input))

  return (
    <div className="timeModal" role="presentation">
      {/* The scrim is the way out of a *non-modal* window: the station stays visible behind
          it and a click anywhere outside the panel puts it away. It is a `button` so it is
          keyboard-reachable too, and every background state is reset so no `button` rule can
          tint the viewport. */}
      <button type="button" className="timeScrim" aria-label="关闭时刻窗口" onClick={() => setTimePanel(false)} />
      <div className="timeWindow" role="dialog" aria-modal={false} aria-label="时刻与客流">
        <div className="timeHead">
          <span className="timeTitle">时刻 · 客流输入</span>
          <span className="timeNow">{stamp ? stamp.readout : '—'}</span>
          {!playing && <span className="clockChip off">已暂停</span>}
          <button type="button" className="timeClose" aria-label="关闭" onClick={() => setTimePanel(false)}>
            ✕
          </button>
        </div>

        <div className="timeBody">
          {/* A. the day's curve */}
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>A · 客流曲线</span>
              <span className="timeBlockNote">
                {stamp ? `${DAY_TYPE_LABELS[stamp.dayType]} · ${PERIOD_LABELS[stamp.period]} · ${stamp.isOpen ? '营业中' : '已闭站'}` : ''}
                {stamp ? ` · 合计 ≈ ${perHour.toLocaleString()} 人/小时` : ''}
              </span>
            </h4>
            <DayCurve input={input} dayType={stamp?.dayType ?? 'weekday'} simTime={simTime ?? 0} />
            <DayCurveLegend dayType={stamp?.dayType ?? 'weekday'} />
          </section>

          {/* B. the calendar */}
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>B · 日历</span>
              <span className="timeBlockNote">
                {stamp ? `${stamp.dateLabel} ${stamp.weekdayLabel} · 第 ${stamp.dayIndex + 1} 天` : '—'}
              </span>
            </h4>
            <div className="dayTypes">
              {DAY_TYPES.map((t) => (
                <span key={t} className={stamp?.dayType === t ? 'dayType active' : 'dayType'}>
                  <b>{DAY_TYPE_LABELS[t]}</b>
                  <i>×{DAY_TYPE_FACTOR[t]}</i>
                </span>
              ))}
              <span className="dayTypeNote">日子由日期决定；节假日与活动日还需要日历表（未开放）</span>
            </div>
          </section>

          {/* D. the settings */}
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>D · 时刻设置</span>
              <span className="timeBlockNote">改动会立即作用于仿真，并进入撤销</span>
            </h4>
            <div className="timeRow">
              <span className="timeLabel">营业时间</span>
              <TimeBox label="开站时间" seconds={station.service.from} onCommit={(s) => setServiceWindow(s, station.service.to)} />
              <span className="timeDash">—</span>
              <TimeBox label="关站时间" seconds={station.service.to} onCommit={(s) => setServiceWindow(station.service.from, s)} />
              {stamp && <span className={stamp.isOpen ? 'clockChip open' : 'clockChip shut'}>{stamp.isOpen ? '营业中' : '已闭站'}</span>}
            </div>
            {[0, 1].map((i) => (
              <div className="timeRow" key={i}>
                <span className="timeLabel">{i === 0 ? '早高峰' : '晚高峰'}</span>
                <TimeBox
                  label={`${i === 0 ? '早' : '晚'}高峰开始`}
                  seconds={station.peaks[i].from}
                  onCommit={(s) => setPeakWindow(i, s, station.peaks[i].to)}
                />
                <span className="timeDash">—</span>
                <TimeBox
                  label={`${i === 0 ? '早' : '晚'}高峰结束`}
                  seconds={station.peaks[i].to}
                  onCommit={(s) => setPeakWindow(i, station.peaks[i].from, s)}
                />
              </div>
            ))}
            <div className="knobs">
              <Knob
                label="早高峰量"
                hint={`${String(DEMAND_AM_HOUR).padStart(2, '0')}:00 的高峰高度`}
                value={knobs.amPeak}
                min={DEMAND_LIMITS.amPeak[0]}
                max={DEMAND_LIMITS.amPeak[1]}
                onDraft={(v) => setDraft({ ...knobs, amPeak: v })}
                onCommit={commitDraft}
              />
              <Knob
                label="晚高峰量"
                hint={`${String(DEMAND_PM_HOUR).padStart(2, '0')}:00 的高峰高度`}
                value={knobs.pmPeak}
                min={DEMAND_LIMITS.pmPeak[0]}
                max={DEMAND_LIMITS.pmPeak[1]}
                onDraft={(v) => setDraft({ ...knobs, pmPeak: v })}
                onCommit={commitDraft}
              />
              <Knob
                label="波形陡峭度"
                hint="高峰的宽窄（100% = 0.85 小时）"
                value={knobs.sharpness}
                min={DEMAND_LIMITS.sharpness[0]}
                max={DEMAND_LIMITS.sharpness[1]}
                onDraft={(v) => setDraft({ ...knobs, sharpness: v })}
                onCommit={commitDraft}
              />
            </div>
          </section>

          {/* The metrics that are about time, in the strip the bottom bar's own metrics use. */}
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>当前统计</span>
              <span className="timeBlockNote">客流、排队与服务等级</span>
            </h4>
            <div className="timeStats">
              <Stat label="站内人数" value={metrics ? metrics.population.toLocaleString() : '—'} />
              <Stat label="最挤等级" value={metrics ? `${metrics.worstLos} ${LOS_LABELS[metrics.worstLos]}` : '—'} tone={metrics?.worstLos} />
              <Stat label="闸机排队" value={metrics ? String(metrics.gateQueue) : '—'} />
              <Stat label="扶梯排队" value={metrics ? String(metrics.escalatorQueue) : '—'} />
              <Stat label="站台门排队" value={metrics ? String(metrics.doorQueue) : '—'} />
              <Stat label="已上车" value={metrics ? String(metrics.boarded) : '—'} />
              <Stat label="已出站" value={metrics ? String(metrics.exited) : '—'} />
              <Stat label="滞留" value={metrics ? String(metrics.leftBehind) : '—'} warn={(metrics?.leftBehind ?? 0) > 0} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, warn, tone }: { label: string; value: string; warn?: boolean; tone?: string }): React.ReactElement {
  const cls = warn ? 'timeStat warn' : tone === 'E' || tone === 'F' ? 'timeStat danger' : 'timeStat'
  return (
    <div className={cls}>
      <span className="timeStatLabel">{label}</span>
      <b>{value}</b>
    </div>
  )
}
