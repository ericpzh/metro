import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The trains' own curve (§6.5 行车间隔, §7.4): people per hour the consists bring
// into the station across **all** lines — every line's per-train 下车 over its
// current headway, times its consists (`sim/headway.ts`'s `trainAlightSeries`).
// It answers the question the entrance curve cannot: what a headway or 编组 edit
// in the 线路 card does to the station's alighting load.
//
// Read-only: the steps move with the same service/peak spans the entrance chart's
// grips author, but the grips themselves live on that chart alone. Same 480 × 112
// viewBox and gutters as `DayCurve`, so the two plots stack as one figure.
import { useMemo } from 'react'
import { hourOfDay } from '../../../sim/demand.ts'
import { trainAlightSeries } from '../../../sim/headway.ts'
import type { PeakWindows, TimeSpan } from '../../../sim/constants.ts'
import type { LineDef, Module } from '../../../sim/types.ts'

const W = 480
const H = 112
const PAD = { left: 60, right: 26, top: 14, bottom: 15 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
/** The same 15-minute grid as the entrance curve, so the steps land together. */
const STEP_MINUTES = 15

const x = (hour: number): number => PAD.left + (hour / 24) * PLOT_W
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

export function TrainCurve({
  lines,
  modules,
  service,
  peaks,
  workday,
  simTime,
}: {
  lines: readonly LineDef[]
  modules: readonly Module[]
  service: TimeSpan
  peaks: PeakWindows
  /** Which timetable to draw: a 非工作日 runs 平峰/离峰 only, so its steps ignore the peaks. */
  workday: boolean
  simTime: number
}): React.ReactElement {
  useLanguage()

  const drawn = useMemo(() => {
    const values = trainAlightSeries(lines, modules, service, peaks, workday, STEP_MINUTES)
    const top = Math.max(100, Math.ceil(Math.max(0, ...values) / 100) * 100)
    const y = (v: number): number => PAD.top + PLOT_H - (v / top) * PLOT_H
    return {
      values,
      top,
      y,
      points: values.map((v, i) => `${x((i * STEP_MINUTES) / 60).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    }
  }, [lines, modules, service, peaks, workday])

  const hour = hourOfDay(simTime)
  const at = Math.min(drawn.values.length - 1, Math.round((hour / 24) * (drawn.values.length - 1)))
  const nowCount = Math.round(drawn.values[at]).toLocaleString('en-US')
  const band = (from: number, to: number): { x: number; width: number } => {
    const a = x(from / 3600)
    return { x: a, width: Math.max(0, x(to / 3600) - a) }
  }

  return (
    <svg
      className="dayCurve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t('train_curve_now_about_value_people_h', nowCount)}
    >
      {/* Shut, open, then the two peaks — the same bands the entrance chart draws. */}
      <rect className="curveClosed" x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />
      <rect className="curveOpen" y={PAD.top} height={PLOT_H} {...band(service.from, service.to)} />
      {workday && peaks.map((p, i) => (
        <rect key={i} className="curvePeak" y={PAD.top} height={PLOT_H} {...band(p.from, p.to)} />
      ))}
      <polyline className="curveLine" points={drawn.points} />
      <line className="curveNow" x1={x(hour)} x2={x(hour)} y1={PAD.top - 3} y2={PAD.top + PLOT_H} />
      <circle className="curveDot" cx={x(hour)} cy={drawn.y(drawn.values[at])} r={2.5} />
      {HOUR_TICKS.map((h) => (
        <text key={h} className="curveTick" x={x(h)} y={H - 4} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
          {translate(String(h).padStart(2, '0'))}
        </text>
      ))}
      <text className="curveTick" x={PAD.left - 4} y={PAD.top - 4} textAnchor="end">
        {t('people_h')}</text>
      <text className="curveTick" x={PAD.left - 4} y={drawn.y(drawn.top) + 8} textAnchor="end">
        {translate(drawn.top.toLocaleString('en-US'))}
      </text>
      <text className="curveTick" x={PAD.left - 4} y={PAD.top + PLOT_H} textAnchor="end">
        0
      </text>
      <text className="curveTick" x={W - 4} y={PAD.top + PLOT_H} textAnchor="end">
        0
      </text>
    </svg>
  )
}
