import { t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The floating **数据** window (§8.1): the counters the status bar shows, over time.
// What opens it is the status bar itself — the left half of the bottom rail, the
// numbers, is a button (`statusbar/BottomBar.tsx`).
//
// Three charts, because they answer three different questions and do not share a y axis:
//
//   平均拥挤等级 — the Fruin letter over time. The axis keeps the letter's own sense:
//     **A at the top, F at the bottom**, so the line a crowded station draws hangs low
//     and a station clearing climbs;
//   站内数值 — the instantaneous readings: 站内人数 and the four queue lengths;
//   客流累计 — the three counters that only climb: 已上车 / 已出站 / 滞留. They are
//     drawn either **累计** (the totals the status bar prints) or **每分钟** (the
//     increase since the previous sample), which is why every sample records both.
//
// Each line toggles on its own chip, so a chart can be narrowed to the one series the
// player is chasing. The series themselves are `historySeries` over the sim's own
// interleaved record (`sim/history.ts`) — the same numbers the HUD reads, one sample a
// minute, so a chart can never disagree with the rail under it.
//
// A line's colour is the only thing that identifies it in the plot; the chip beside it
// carries the same colour and the label, which is the legend.
import { useEffect, useState } from 'react'
import { useStore } from '../../store.ts'
import { LOS_ORDER } from '../../../sim/constants.ts'
import { historySeries, type HistoryColumn } from '../../../sim/history.ts'
import { clockTextOf } from '../../../sim/clock.ts'
import { LineChart, type ChartLine, type AxisTick } from './LineChart.tsx'
import { axisTicks, losAxis, losValue, niceMax } from './scale.ts'

/** How many time labels a chart carries along its bottom. */
const TIME_SLOTS = 7

/**
 * One colour per line, picked to stay apart on the dark drafting background *and* to
 * mean something: the crowd letter and 滞留 wear the warning/danger tones the status
 * bar already gives them.
 */
const COLOUR = {
  crowdLos: 'var(--chart-amber, #ffc861)',
  population: 'var(--chart-blue, #55b6ff)',
  gateQueue: 'var(--chart-orange, #ff9d76)',
  escalatorQueue: 'var(--chart-green, #7ee3a1)',
  liftQueue: 'var(--chart-purple, #c9a3ff)',
  doorQueue: 'var(--chart-teal, #6fc7d8)',
  boarded: 'var(--chart-blue, #55b6ff)',
  exited: 'var(--chart-green, #7ee3a1)',
  leftBehind: 'var(--chart-red, #ff6b6b)',
} as const

/** The time-of-day labels a chart prints, evenly spread over its samples. */
function timeLabels(times: number[], slots = TIME_SLOTS): string[] {
  if (times.length === 0) return []
  const shown = Math.min(slots, times.length)
  const out: string[] = []
  for (let i = 0; i < shown; i++) {
    const at = shown === 1 ? 0 : Math.round((i / (shown - 1)) * (times.length - 1))
    out.push(clockTextOf(times[at]))
  }
  return out
}

/** One chart's legend: a chip per line, and the only way a line is turned off. */
function Legend({
  lines,
  hidden,
  onToggle,
}: {
  lines: ChartLine[]
  hidden: Record<string, boolean>
  onToggle: (key: string) => void
}): React.ReactElement {
  useLanguage()
  return (
    <div className="chartLegend">
      {lines.map((line) => (
        <button
          key={line.key}
          type="button"
          className={hidden[line.key] ? 'chartChip off' : 'chartChip'}
          aria-pressed={!hidden[line.key]}
          onClick={() => onToggle(line.key)}
        >
          <i style={{ background: line.colour }} />
          {line.label}
        </button>
      ))}
    </div>
  )
}

export function ChartsPanel(): React.ReactElement | null {
  useLanguage()
  const open = useStore((s) => s.chartsPanel)
  const setChartsPanel = useStore((s) => s.setChartsPanel)
  const history = useStore((s) => s.history)
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  // Which reading of the climbing counters 客流累计 is drawn with: the totals (§8.1's
  // "was the station saturated all morning?") or the per-minute flow (when exactly did
  // it break?). Every sample stores both, so this is only a choice of column.
  const [totalsMode, setTotalsMode] = useState<'cumulative' | 'perMinute'>('cumulative')

  // Escape closes it, like every other gesture; a closed panel forgets which lines
  // were hidden, so reopening shows the whole set again.
  useEffect(() => {
    if (!open) {
      setHidden({})
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setChartsPanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setChartsPanel])

  if (!open) return null

  const { values, count } = history
  const column = (name: HistoryColumn): number[] => historySeries(values, name, count)
  const times = column('simTime')
  const xLabels = timeLabels(times)
  /** The class chart's top: A is drawn here, F at 0 (see `scale.ts`'s `losAxis`). */
  const losTop = LOS_ORDER.length - 1
  const hiddenOf = (lines: ChartLine[]): ChartLine[] => lines.filter((line) => !hidden[line.key])
  const toggle = (key: string): void => setHidden((h) => ({ ...h, [key]: !h[key] }))
  const topOf = (lines: ChartLine[]): number => {
    let peak = 0
    for (const line of lines) for (const v of line.values) if (v > peak) peak = v
    return niceMax(peak)
  }
  const tick = (v: number): string => Math.round(v).toLocaleString('en-US')
  /** A number axis' gridlines, with a repeated rounded label dropped (a flat 0–1 axis). */
  const numberTicks = (top: number): AxisTick[] => {
    const ticks: AxisTick[] = []
    for (const value of axisTicks(top)) {
      const label = tick(value)
      if (ticks[ticks.length - 1]?.label !== label) ticks.push({ value, label })
    }
    return ticks
  }

  const crowdLines: ChartLine[] = [
    {
      key: 'crowdLos',
      label: t('avg_crowd_level'),
      colour: COLOUR.crowdLos,
      // The one inverted axis: **A at the top, F at the bottom**, the way the letter
      // reads (the mapping itself is `losValue` / `losAxis`, where the suite pins it).
      values: column('crowdLos').map((index) => losValue(index, LOS_ORDER)),
    },
  ]
  const stationLines: ChartLine[] = [
    { key: 'population', label: t('passengers_inside'), colour: COLOUR.population, values: column('population') },
    { key: 'gateQueue', label: t('gate_queue'), colour: COLOUR.gateQueue, values: column('gateQueue') },
    { key: 'escalatorQueue', label: t('escalator_queue'), colour: COLOUR.escalatorQueue, values: column('escalatorQueue') },
    { key: 'liftQueue', label: t('lift_queue'), colour: COLOUR.liftQueue, values: column('liftQueue') },
    { key: 'doorQueue', label: t('platform_door_queue'), colour: COLOUR.doorQueue, values: column('doorQueue') },
  ]
  const totalLines: ChartLine[] = [
    { key: 'boarded', label: t('boarded'), colour: COLOUR.boarded, values: column('boarded') },
    { key: 'exited', label: t('exited'), colour: COLOUR.exited, values: column('exited') },
    { key: 'leftBehind', label: t('left_behind'), colour: COLOUR.leftBehind, values: column('leftBehind') },
  ]
  const perMinuteLines: ChartLine[] = [
    { key: 'boarded', label: t('boarded'), colour: COLOUR.boarded, values: column('boardedPerMin') },
    { key: 'exited', label: t('exited'), colour: COLOUR.exited, values: column('exitedPerMin') },
    { key: 'leftBehind', label: t('left_behind'), colour: COLOUR.leftBehind, values: column('leftBehindPerMin') },
  ]
  const flowLines = totalsMode === 'cumulative' ? totalLines : perMinuteLines
  // The shown subset sets each chart's own scale, so hiding a tall line rescales the rest.
  const shownStation = hiddenOf(stationLines)
  const shownFlow = hiddenOf(flowLines)

  return (
    <div className="timeModal" role="presentation">
      <button
        type="button"
        className="timeScrim"
        aria-label={t('close_data_window')}
        onClick={() => setChartsPanel(false)}
      />
      <div className="timeWindow chartsWindow" role="dialog" aria-modal={false} aria-label={t('data')}>
        <div className="timeHead">
          <span className="timeTitle">{t('data')}</span>
          <button type="button" className="timeClose" aria-label={t('close')} onClick={() => setChartsPanel(false)}>
            ✕
          </button>
        </div>

        <div className="timeBody">
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('avg_crowd_level')}</span>
            </h4>
            <Legend lines={crowdLines} hidden={hidden} onToggle={toggle} />
            {count === 0 ? (
              <p className="chartEmpty">{t('no_data_yet')}</p>
            ) : (
              <LineChart
                lines={hiddenOf(crowdLines)}
                top={losTop}
                yTicks={losAxis(LOS_ORDER)}
                xLabels={xLabels}
                ariaLabel={t('avg_crowd_level')}
              />
            )}
          </section>

          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('station_numbers')}</span>
            </h4>
            <Legend lines={stationLines} hidden={hidden} onToggle={toggle} />
            {count === 0 ? (
              <p className="chartEmpty">{t('no_data_yet')}</p>
            ) : (
              <LineChart
                lines={shownStation}
                top={topOf(shownStation)}
                yTicks={numberTicks(topOf(shownStation))}
                xLabels={xLabels}
                ariaLabel={t('station_numbers')}
              />
            )}
          </section>

          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('passenger_totals')}</span>
              <span className="timeBlockNote chartModes">
                <button
                  type="button"
                  className={totalsMode === 'cumulative' ? 'chartMode on' : 'chartMode'}
                  aria-pressed={totalsMode === 'cumulative'}
                  onClick={() => setTotalsMode('cumulative')}
                >
                  {t('cumulative')}
                </button>
                <button
                  type="button"
                  className={totalsMode === 'perMinute' ? 'chartMode on' : 'chartMode'}
                  aria-pressed={totalsMode === 'perMinute'}
                  onClick={() => setTotalsMode('perMinute')}
                >
                  {t('per_minute')}
                </button>
              </span>
            </h4>
            <Legend lines={flowLines} hidden={hidden} onToggle={toggle} />
            {count === 0 ? (
              <p className="chartEmpty">{t('no_data_yet')}</p>
            ) : (
              <LineChart
                lines={shownFlow}
                top={topOf(shownFlow)}
                yTicks={numberTicks(topOf(shownFlow))}
                xLabels={xLabels}
                ariaLabel={t('passenger_totals')}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
