import { useLanguage } from '../../i18n.ts'
import type { AxisTick } from './scale.ts'
// One line chart of the 数据 window (§8.1): a set of series sampled on a uniform
// grid, drawn against time. The `DayCurve` idiom: a fixed viewBox scaled **uniformly**
// to the panel's width, every stroke `non-scaling-stroke` so a line stays a line at
// any width, and the axis arithmetic in `scale.ts` where the suite can reach it.
//
// It is deliberately dumb: which series exist, what colour each is and whether it is
// shown at all belong to `ChartsPanel`, because those are the player's toggles. This
// only maps sample index → x and value → y.

export interface ChartLine {
  /** Stable identity for React, and what the panel's toggle keys off. */
  key: string
  /** Already translated: the legend chip and the accessible name. */
  label: string
  /** The stroke and the chip's own swatch. */
  colour: string
  /** One value per sample; the longest line sets the chart's sample count. */
  values: number[]
}

export type { AxisTick }

const W = 480
const H = 128
// The gutter carries translated counts; the right edge is bare.
const PAD = { left: 40, right: 10, top: 10, bottom: 14 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

export function LineChart({
  lines,
  top,
  yTicks,
  xLabels,
  ariaLabel,
}: {
  lines: ChartLine[]
  /** The axis' own top: `niceMax` of every visible line's peak. */
  top: number
  /** Gridlines, bottom to top. */
  yTicks: AxisTick[]
  /** Time labels along the bottom, evenly spread (a multiple of the sample grid). */
  xLabels: string[]
  ariaLabel: string
}): React.ReactElement {
  useLanguage()
  const count = lines.reduce((most, line) => Math.max(most, line.values.length), 0)
  // A single sample has no span to place against; it sits on the left edge.
  const x = (i: number): number => PAD.left + (count <= 1 ? 0 : (i / (count - 1)) * PLOT_W)
  const y = (v: number): number =>
    PAD.top + PLOT_H - Math.min(1, Math.max(0, top > 0 ? v / top : 0)) * PLOT_H
  const points = (values: number[]): string =>
    values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      <rect className="chartPlot" x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />
      {yTicks.map((tick) => (
        <g key={tick.label + tick.value}>
          <line className="chartGrid" x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(tick.value)} y2={y(tick.value)} />
          <text className="chartTick" x={PAD.left - 4} y={y(tick.value) + 3} textAnchor="end">
            {tick.label}
          </text>
        </g>
      ))}
      {lines.map((line) =>
        line.values.length === 1 ? (
          // One sample is a reading, not yet a line: draw it as the dot it is.
          <circle key={line.key} className="chartDot" cx={x(0)} cy={y(line.values[0])} r={2.4} style={{ fill: line.colour }} />
        ) : (
          <polyline key={line.key} className="chartLine" points={points(line.values)} style={{ stroke: line.colour }} />
        ),
      )}
      {xLabels.map((label, i) => {
        const at = xLabels.length <= 1 ? 0 : (i / (xLabels.length - 1)) * (count - 1)
        return (
          <text
            key={label + i}
            className="chartTick"
            x={x(at)}
            y={H - 3}
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
          >
            {label}
          </text>
        )
      })}
    </svg>
  )
}
