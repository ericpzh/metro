// The day's demand curve, drawn (§7.4, sheet 06's panel A): one line per kind of day over
// 00:00–24:00, the station's operating hours lit behind them, the two 高峰 windows shaded on
// top, and the playhead at now.
//
// The lines are `sim/demand.ts`'s own samples — the same `demandAt` the spawn draws its
// arrivals from — so a slider dragged in the panel beside this redraws the picture *and*
// moves the crowd, and the two can never describe different days.
//
// The plot is a 480 × 120 viewBox scaled **uniformly** to the panel's width, so the tick
// labels scale with it instead of stretching, and every stroke carries
// `vector-effect: non-scaling-stroke` so a line stays a line at any width.
import { useMemo } from 'react'
import { DAY_TYPE_LABELS, clockTextOf, type DayType } from '../../../sim/clock.ts'
import { demandSeries, hourOfDay, type DemandInput } from '../../../sim/demand.ts'

/** The drawn box, in viewBox units. */
const W = 480
const H = 120
const PAD = { left: 26, right: 6, top: 8, bottom: 15 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
/** One sample every 15 simulated minutes: 97 points, the last closing onto the first. */
const STEP_MINUTES = 15

const x = (hour: number): number => PAD.left + (hour / 24) * PLOT_W

/** 00 03 06 … 24, the ticks sheet 06's panel A carries. */
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

/**
 * The series: 工作日, 周六 and whichever of 周日 / 节假日 the station's calendar is on — three
 * lines rather than four, because a holiday and a Sunday differ by a few percent and a
 * chart cannot show that as two curves. The **active** day type is the one drawn bright,
 * so the line the playhead crosses is the day being simulated.
 */
function seriesFor(dayType: DayType, input: DemandInput): Array<{ key: DayType; values: number[]; active: boolean }> {
  const third: DayType = dayType === 'holiday' ? 'holiday' : 'sunday'
  return (['weekday', 'saturday', third] as DayType[]).map((key) => ({
    key,
    values: demandSeries(key, input, STEP_MINUTES),
    active: key === dayType,
  }))
}

export function DayCurve({ input, dayType, simTime }: { input: DemandInput; dayType: DayType; simTime: number }): React.ReactElement {
  // The samples and their SVG points are memoized on the *day* — the panel around this
  // re-renders on every worker frame while the sim runs, and 3 × 97 samples plus their
  // point strings per frame is work that changes only when a knob or a window does.
  const drawn = useMemo(() => {
    const series = seriesFor(dayType, input)
    const top = Math.ceil(Math.max(1, ...series.map((s) => Math.max(...s.values))) * 10) / 10 + 0.1
    const y = (v: number): number => PAD.top + PLOT_H - (v / top) * PLOT_H
    return {
      top,
      y,
      lines: series.map((s) => ({
        key: s.key,
        active: s.active,
        values: s.values,
        points: s.values.map((v, i) => `${x((i * STEP_MINUTES) / 60).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      })),
    }
  }, [dayType, input])

  const hour = hourOfDay(simTime)
  const active = drawn.lines.find((s) => s.active) ?? drawn.lines[0]
  const at = Math.min(active.values.length - 1, Math.round((hour / 24) * (active.values.length - 1)))
  const band = (from: number, to: number): { x: number; width: number } => {
    const a = x(from / 3600)
    return { x: a, width: Math.max(0, x(to / 3600) - a) }
  }

  return (
    <svg
      className="dayCurve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`24 小时客流曲线（${DAY_TYPE_LABELS[active.key]}），当前 ${Math.round(active.values[at] * 100)}%`}
    >
      {/* Shut, open, then the two peaks — the same three bands the 信息栏's clock card draws
          across its own day bar, from the same station document. */}
      <rect className="curveClosed" x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />
      <rect className="curveOpen" y={PAD.top} height={PLOT_H} {...band(input.service.from, input.service.to)} />
      {input.peaks.map((p, i) => (
        <rect key={i} className="curvePeak" y={PAD.top} height={PLOT_H} {...band(p.from, p.to)} />
      ))}
      {/* The baseline the knobs are relative to: the reference weekday's peak is 100%. */}
      <line className="curveBase" x1={PAD.left} x2={PAD.left + PLOT_W} y1={drawn.y(1)} y2={drawn.y(1)} />
      {drawn.lines.map((s) => (
        <polyline key={s.key} className={s.active ? 'curveLine active' : 'curveLine'} points={s.points} />
      ))}
      <line className="curveNow" x1={x(hour)} x2={x(hour)} y1={PAD.top - 3} y2={PAD.top + PLOT_H} />
      <circle className="curveDot" cx={x(hour)} cy={drawn.y(active.values[at])} r={2.5} />
      {HOUR_TICKS.map((h) => (
        <text key={h} className="curveTick" x={x(h)} y={H - 4} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
          {String(h).padStart(2, '0')}
        </text>
      ))}
      <text className="curveTick" x={PAD.left - 4} y={drawn.y(drawn.top) + 8} textAnchor="end">
        {Math.round(drawn.top * 100)}%
      </text>
      <text className="curveTick" x={PAD.left - 4} y={PAD.top + PLOT_H} textAnchor="end">
        0
      </text>
      {/* The window's own ends, so the lit band is readable without the settings rows. */}
      <text className="curveTick" x={x(input.service.from / 3600)} y={PAD.top + 8} textAnchor="start">
        {`营业 ${clockTextOf(input.service.from)}`}
      </text>
      <text className="curveTick" x={x(input.service.to / 3600)} y={PAD.top + 8} textAnchor="end">
        {`${clockTextOf(input.service.to)} 关站`}
      </text>
    </svg>
  )
}

/** The legend under the chart: which line is which, and what the 100% line means. */
export function DayCurveLegend({ dayType }: { dayType: DayType }): React.ReactElement {
  const third: DayType = dayType === 'holiday' ? 'holiday' : 'sunday'
  return (
    <div className="curveLegend">
      {(['weekday', 'saturday', third] as DayType[]).map((k) => (
        <span key={k} className={k === dayType ? 'curveKey active' : 'curveKey'}>
          <i />
          {DAY_TYPE_LABELS[k]}
        </span>
      ))}
      <span className="curveKeyNote">基准 100% = 工作日高峰</span>
    </div>
  )
}
