// The 信息栏's clock: the station's own time, at the top of the column above the
// folders, so no fold hides it.
//
// **The card is a button.** Everything it prints is the *summary* of the day — the time
// to the second, the period the timetable is running, the date and the day type, and
// whether the station is open — and pressing it opens the floating 时刻 window
// (`windows/time/TimePanel.tsx`) where the same day is plotted and authored (§9.6C). So
// the one thing the card has to look like is something you can press: it wears the panel's
// card chrome with a hover, and says 时刻 with a chevron so the affordance is not only a
// hover away.
//
//   * the time of day, to the second,
//   * the **period** the timetable is running — 高峰 / 平峰 / 夜间, read from
//     `sim/clock.ts`, which reads the same `periodOf` the dispatcher picks its headway
//     with (§6.5), so the chip cannot say 平峰 while the sim is running its peak,
//   * the **date and weekday**, the **day type** the demand is authored against (§7.4's
//     `calendar(dayOfYear)`: 工作日 / 周六 / 周日 / 节假日) and **营业中 / 已闭站** beside it,
//   * a day bar with the operating hours lit, the two peak windows marked and a playhead
//     at now.
//
// The whole card dims while the sim is paused: a clock that has stopped looks broken
// unless it says so.
import { useMemo } from 'react'
import { useStore } from '../../store.ts'
import { SIM_DAY } from '../../../sim/constants.ts'
import { DEFAULT_CALENDAR, DAY_TYPE_LABELS, PERIOD_LABELS, stampAt } from '../../../sim/clock.ts'

/** A span of the day on the 24 h bar, as CSS. The window and every peak use it. */
function span(from: number, to: number): { left: string; width: string } {
  return { left: `${(from / SIM_DAY) * 100}%`, width: `${((to - from) / SIM_DAY) * 100}%` }
}

export function ClockCard(): React.ReactElement {
  const simTime = useStore((s) => s.metrics?.simTime ?? null)
  const playing = useStore((s) => s.playing)
  const service = useStore((s) => s.station.service)
  const peaks = useStore((s) => s.station.peaks)
  const setTimePanel = useStore((s) => s.setTimePanel)
  const stamp = useMemo(
    () => (simTime === null ? null : stampAt(simTime, DEFAULT_CALENDAR, service, peaks)),
    [simTime, service, peaks],
  )

  return (
    // The accessible name is the whole clock in the timetable's own one-line form
    // (`1月1日 07:27:25 四`) plus what pressing it does: the rows below lay the same stamp
    // out with room to explain it, and the button is the way into the day's own window.
    <button
      type="button"
      className={playing ? 'card clockCard' : 'card clockCard paused'}
      onClick={() => setTimePanel(true)}
      aria-haspopup="dialog"
      aria-label={stamp ? `模拟时间 ${stamp.readout}，打开时刻与客流设置` : '打开时刻与客流设置'}
    >
      <span className="clockTop">
        <b className="clockDigits">{stamp ? stamp.clockSeconds : '--:--:--'}</b>
        {stamp && <span className={`clockChip ${stamp.period}`}>{PERIOD_LABELS[stamp.period]}</span>}
        {!playing && <span className="clockChip off">已暂停</span>}
        <span className="clockMore">时刻 ›</span>
      </span>
      <span className="clockDate">
        <span className="clockDateText">{stamp ? `${stamp.dateLabel} ${stamp.weekdayLabel}` : '—'}</span>
        {stamp && <span className="clockChip day">{DAY_TYPE_LABELS[stamp.dayType]}</span>}
        {stamp && <span className={stamp.isOpen ? 'clockChip open' : 'clockChip shut'}>{stamp.isOpen ? '营业中' : '已闭站'}</span>}
        {stamp && stamp.dayIndex > 0 && <span className="clockChip day">第 {stamp.dayIndex + 1} 天</span>}
      </span>
      {/* The day: 00:00 to 24:00, the **operating hours** lit — everything outside them is
          a shut station — the two 高峰 windows shaded on top of that, and the playhead at
          now. Both bands are painted from the data the sim itself is running on
          (`station.service`, `station.peaks`), so the chips above and the bands below
          cannot describe different hours. */}
      <span className="clockTrack" aria-hidden="true">
        <i className="clockOpen" style={span(service.from, service.to)} />
        {peaks.map((p, i) => (
          <i key={i} className="clockPeak" style={span(p.from, p.to)} />
        ))}
        <i className="clockNow" style={{ left: `${(stamp?.dayFraction ?? 0) * 100}%` }} />
      </span>
      <span className="clockHours" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </span>
    </button>
  )
}
