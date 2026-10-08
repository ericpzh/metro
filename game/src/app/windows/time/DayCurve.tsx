// The day's demand curve, drawn **and authored** (§7.4, sheet 06's panels A and D): one line
// per kind of day over 00:00–24:00, the station's operating hours lit behind them, the two
// 高峰 windows shaded on top, a playhead at now — and the **six boundaries that shape all of
// it** as draggable grips.
//
// The lines are `sim/demand.ts`'s own samples — the same `demandAt` the spawn draws its
// arrivals from — so a boundary dragged here redraws the picture *and* changes the crowd, and
// the two can never describe different days.
//
// **A drag is a gesture, not a document write.** The panel above owns the draft: this component
// only reports "the 早高峰 start is at 07:10 now" on every pointer move, and "let go" once. That
// is what keeps a drag from pushing an undo frame and a worker rebuild per pixel, and it is why
// the grips work in hours (a float) while the document stores whole minutes.
//
// The plot is a 480 × 128 viewBox scaled **uniformly** to the panel's width, so the tick labels
// scale with it instead of stretching, and every stroke carries
// `vector-effect: non-scaling-stroke` so a line stays a line at any width.
import { useMemo, useRef } from 'react'
import { DAY_TYPE_LABELS, clockTextOf, type DayType } from '../../../sim/clock.ts'
import { demandSeries, hourOfDay, type DemandInput } from '../../../sim/demand.ts'

/** The drawn box, in viewBox units. */
const W = 480
const H = 112
const PAD = { left: 26, right: 38, top: 14, bottom: 15 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
/** One sample every 15 simulated minutes: 97 points, the last closing onto the first. */
const STEP_MINUTES = 15
/** How far a grip's own hit box reaches either side of its line, in viewBox units. Roughly a
    finger's width at the panel's real size, which is what makes a 1 px boundary grabbable. */
const GRIP_HIT = 5

const x = (hour: number): number => PAD.left + (hour / 24) * PLOT_W

/** 00 03 06 … 24, the ticks sheet 06's panel A carries. */
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

/** One of the six boundaries a drag can move: 营业时间's two ends and both peaks'. */
export interface CurveBoundary {
  kind: 'service' | 'peak'
  /** Which peak, for `kind: 'peak'`. */
  index: number
  end: 'from' | 'to'
  /** Seconds since midnight. */
  seconds: number
  /** What the grip is called, for a screen reader. */
  label: string
  /** Where it stands, in hours, and how wide the span it belongs to is. */
  hours: number
}

/** The six boundaries of `input`, in the order the chart draws their grips. */
export function curveBoundaries(input: DemandInput): CurveBoundary[] {
  const list: CurveBoundary[] = [
    { kind: 'service', index: 0, end: 'from', seconds: input.service.from, label: '开站时间', hours: input.service.from / 3600 },
    { kind: 'service', index: 0, end: 'to', seconds: input.service.to, label: '关站时间', hours: input.service.to / 3600 },
  ]
  input.peaks.forEach((p, i) => {
    const whose = i === 0 ? '早' : '晚'
    list.push({ kind: 'peak', index: i, end: 'from', seconds: p.from, label: `${whose}高峰开始`, hours: p.from / 3600 })
    list.push({ kind: 'peak', index: i, end: 'to', seconds: p.to, label: `${whose}高峰结束`, hours: p.to / 3600 })
  })
  return list
}

export function DayCurve({
  input,
  dayType,
  simTime,
  baseRate,
  onDrag,
  onDragEnd,
  onNudge,
}: {
  input: DemandInput
  dayType: DayType
  simTime: number
  /** Station-wide street inflow at curve = 1 (Σ open exits' inRate, 人/时): the right
      axis is `curve × baseRate`, the same product `World.spawnStreet` draws from. */
  baseRate: number
  /** A grip moved: the boundary and where it now stands, in hours. */
  onDrag: (boundary: CurveBoundary, hours: number) => void
  /** The gesture finished — commit what the draft holds. */
  onDragEnd: () => void
  /** A keyboard nudge: move the boundary **and** commit it, in one step. */
  onNudge: (boundary: CurveBoundary, hours: number) => void
}): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null)
  const held = useRef<CurveBoundary | null>(null)

  // **One line: the day the station is running.** The samples and their SVG points are memoized on
  // the *day* — the panel around this re-renders on every worker frame while the sim runs, and 97
  // samples plus their point strings per frame is work that changes only when the day does.
  const drawn = useMemo(() => {
    const values = demandSeries(dayType, input, STEP_MINUTES)
    const top = Math.ceil(Math.max(1, ...values) * 10) / 10 + 0.1
    const y = (v: number): number => PAD.top + PLOT_H - (v / top) * PLOT_H
    return {
      values,
      top,
      y,
      points: values.map((v, i) => `${x((i * STEP_MINUTES) / 60).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    }
  }, [dayType, input])

  const hour = hourOfDay(simTime)
  const at = Math.min(drawn.values.length - 1, Math.round((hour / 24) * (drawn.values.length - 1)))
  // Right axis: the same curve in people — Σ open exits' inRate (人/时 at curve = 1)
  // times the curve value, the product `World.spawnStreet` draws arrivals from.
  const countAt = (v: number): string => Math.round(v * baseRate).toLocaleString('en-US')
  const nowCount = countAt(drawn.values[at])
  // The 100% baseline's own count, drawn only when it sits clear of both ends.
  const showBase = drawn.y(1) - drawn.y(drawn.top) > 10 && PAD.top + PLOT_H - drawn.y(1) > 10
  const band = (from: number, to: number): { x: number; width: number } => {
    const a = x(from / 3600)
    return { x: a, width: Math.max(0, x(to / 3600) - a) }
  }

  /** The pointer's own hour, from wherever it is over the plot — the SVG scales uniformly, so
      the box's own width is the whole conversion. */
  const hourAt = (clientX: number): number => {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    const vx = ((clientX - box.left) / box.width) * W
    return Math.min(24, Math.max(0, ((vx - PAD.left) / PLOT_W) * 24))
  }

  const begin = (e: React.PointerEvent<SVGRectElement>, b: CurveBoundary): void => {
    e.preventDefault()
    held.current = b
    // Capture on the **svg**, not the grip: the pointer leaves a 10-unit-wide box immediately,
    // and without capture the drag would stop the moment it did.
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!held.current) return
    onDrag(held.current, hourAt(e.clientX))
  }

  const end = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!held.current) return
    held.current = null
    const svg = svgRef.current
    // A second finger's own pointerup must not throw: capture is only ever held for the pointer
    // the drag started with.
    if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId)
    onDragEnd()
  }

  /**
   * Arrow keys move a grip, so the boundaries are authorable without a pointer at all. A key
   * press is drag-and-let-go in one event, which is why it is handed over as a **nudge**: the
   * panel's commit reads the draft state, and state set in this same event is not there yet.
   */
  const nudge = (e: React.KeyboardEvent<SVGRectElement>, b: CurveBoundary): void => {
    const step = e.shiftKey ? 3600 : 900
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    onNudge(b, Math.min(24, Math.max(0, b.hours + (e.key === 'ArrowRight' ? step : -step) / 3600)))
  }

  return (
    <svg
      ref={svgRef}
      className="dayCurve"
      viewBox={`0 0 ${W} ${H}`}
      // **Not `role="img"`**: the six grips are sliders inside this drawing, and an image role
      // hides its own children from a screen reader. A labelled group keeps them reachable.
      role="group"
      aria-label={`24 小时客流曲线（${DAY_TYPE_LABELS[dayType]}），当前 ${Math.round(drawn.values[at] * 100)}% · 约 ${nowCount} 人/时`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
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
      <polyline className="curveLine" points={drawn.points} />
      <line className="curveNow" x1={x(hour)} x2={x(hour)} y1={PAD.top - 3} y2={PAD.top + PLOT_H} />
      <circle className="curveDot" cx={x(hour)} cy={drawn.y(drawn.values[at])} r={2.5} />
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
      {/* Right axis: the left percentages in people — curve × Σ open exits' inRate. */}
      <text className="curveTick" x={PAD.left + PLOT_W + 4} y={PAD.top - 4} textAnchor="start">
        人/时
      </text>
      <text className="curveTick" x={PAD.left + PLOT_W + 4} y={drawn.y(drawn.top) + 8} textAnchor="start">
        {countAt(drawn.top)}
      </text>
      {showBase && (
        <text className="curveTick" x={PAD.left + PLOT_W + 4} y={drawn.y(1) + 3} textAnchor="start">
          {countAt(1)}
        </text>
      )}
      <text className="curveTick" x={PAD.left + PLOT_W + 4} y={PAD.top + PLOT_H} textAnchor="start">
        0
      </text>
      {/* The spans' own times are **not** printed in here: the panel lists all three under the
          chart (`营业 05:55–23:30 · 早高峰 07:30–09:00 · 晚高峰 17:30–19:00`), where they read as one
          row instead of two labels sitting on the curves' shoulders. The grips keep their
          `aria-label`s, so the numbers are still there for anyone who cannot see the chart. */}
      {/* The six grips. A drag anywhere on one of them moves that boundary and nothing else. */}
      {curveBoundaries(input).map((b) => (
        <g key={`${b.kind}${b.index}${b.end}`} className={`curveGrip ${b.kind}`}>
          <rect
            className="curveGripHit"
            x={x(b.hours) - GRIP_HIT}
            y={PAD.top - 8}
            width={GRIP_HIT * 2}
            height={PLOT_H + 8}
            tabIndex={0}
            role="slider"
            aria-label={b.label}
            aria-valuenow={Math.round(b.seconds / 60)}
            aria-valuemin={0}
            aria-valuemax={23 * 60 + 59}
            aria-valuetext={clockTextOf(b.seconds)}
            onPointerDown={(e) => begin(e, b)}
            onKeyDown={(e) => nudge(e, b)}
          />
          <line className="curveGripLine" x1={x(b.hours)} x2={x(b.hours)} y1={PAD.top - 8} y2={PAD.top + PLOT_H} />
          <rect className="curveGripKnob" x={x(b.hours) - 3.5} y={PAD.top - 11} width={7} height={7} />
        </g>
      ))}
    </svg>
  )
}
