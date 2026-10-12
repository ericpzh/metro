import { translate, t } from '../../../sim/i18n.ts'
import { useLanguage } from '../../i18n.ts'
// The floating **时刻** window (§9.6C 时刻 / 客流输入, sheet 06's panels A, B and D): what the
// 信息栏's clock card opens when it is pressed.
//
// Three blocks and nothing else:
//
//   进站客流曲线 — the station's street-entrance demand over 24 hours, drawn from
//     `sim/demand.ts` (the module the spawn draws its arrivals from), with its
//     **boundaries draggable straight on the chart**: 营业时间's two ends and, on a
//     工作日, both peaks'. There are no time boxes — the line *is* the control, and
//     each grip prints its own `HH:MM` beside it. Under the chart, the three 客流曲线
//     knobs. This curve is entrances only: what the 线路 card's trains bring in
//     is the next block's. The title names which of the two saved curves is showing —
//     the calendar date the run stands on decides, 工作日 or 非工作日;
//   列车客流曲线 — people per hour the consists bring in across all lines
//     (`sim/headway.ts`'s `trainAlightSeries`: per-train 下车 over the running
//     headway, times each line's consists), read-only, on the same bands. A
//     headway or 编组 edit moves this curve and leaves the entrance one alone.
//     The three spans' own times sit under it, following the draft;
//   日历 — the 2026 calendar, a month at a time, every date carrying the day type it derives
//     (工作日 / 非工作日, holidays highlighted). Pressing a date seeks the run onto it,
//     which is how the player swaps the curves above between the two saved sets.
//
// **A gesture is a draft until it is let go.** A drag writes local state — so the curve redraws
// under the hand — and the document is committed on release. Committing per pointer move would
// push an undo frame and a worker rebuild for every pixel of a drag.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store.ts'
import {
  DAY_TYPE_LABELS,
  MONTH_GRID_HEADS,
  MONTH_LABELS,
  SERVICE_LATEST,
  SERVICE_MIN_SPAN,
  clockTextOf,
  dayAt,
  monthGrid,
  type CalendarCell,
  type SimDate,
} from '../../../sim/clock.ts'
import type { DemandInput, DemandKnobs } from '../../../sim/demand.ts'
import { demandRate } from '../../../sim/demand.ts'
import { trainAlightPerHourAt } from '../../../sim/headway.ts'
import type { PeakWindows, TimeSpan } from '../../../sim/constants.ts'
import { DayCurve, type CurveBoundary } from './DayCurve.tsx'
import { TrainCurve } from './TrainCurve.tsx'

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
  useLanguage()
  return (
    <label className="knob">
      <span className="knobHead">
        <span className="knobLabel">{translate(label)}</span>
        <b className="knobValue">{translate(Math.round(value * 100))}%</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        aria-label={translate(label)}
        onChange={(e) => onDraft(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <span className="knobHint">{translate(hint)}</span>
    </label>
  )
}

export function TimePanel(): React.ReactElement | null {
  useLanguage()
  const open = useStore((s) => s.timePanel)
  const setTimePanel = useStore((s) => s.setTimePanel)
  const simTime = useStore((s) => s.metrics?.simTime ?? null)
  const station = useStore((s) => s.station)
  const setServiceWindow = useStore((s) => s.setServiceWindow)
  const setPeakWindow = useStore((s) => s.setPeakWindow)
  const setDemandKnobs = useStore((s) => s.setDemandKnobs)
  const seekToDate = useStore((s) => s.seekToDate)
  const [knobDraft, setKnobDraft] = useState<DemandKnobs | null>(null)
  const [spanDraft, setSpanDraft] = useState<{ service: TimeSpan; peaks: PeakWindows } | null>(null)
  // The calendar view's own month, opened on 第 1 天's: the picker's subject is which date day 0
  // is, so that is the month the player wants to look at. It stays where they put it afterwards.
  // The calendar view's own month, opened on the day the station is standing on — the cell the
  // player is picking *from* — and left where they put it afterwards. It is an initial value, not
  // a subscription: a run that crosses into a new month must not yank the grid out from under a
  // click.
  const [month, setMonth] = useState(() =>
    simTime === null ? station.calendar.epoch.month : dayAt(simTime, station.calendar).date.month,
  )
  // Escape closes it, the way it backs out of every other gesture in the game. Closing also
  // **discards an uncommitted draft** — a drag or a slider the player never let go of is a
  // gesture they walked away from, and a draft that outlived it would show a day the sim is not
  // running.
  useEffect(() => {
    if (!open) {
      setKnobDraft(null)
      setSpanDraft(null)
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTimePanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setTimePanel])

  // Which of the two saved curves the panel shows: the calendar date the run is
  // standing on decides, so seeking to a Sunday swaps both charts to the 非工作日
  // curves and the knobs author that set.
  const today = simTime === null ? null : dayAt(simTime, station.calendar)
  const workday = (today?.dayType ?? 'workday') === 'workday'
  const shown = workday ? 'workday' : 'offday'
  const dayName = translate(DAY_TYPE_LABELS[shown])

  const knobs = knobDraft ?? station.demand[shown]
  const spans = spanDraft ?? { service: station.service, peaks: station.peaks }
  const input: DemandInput = useMemo(
    () => ({
      service: spans.service,
      peaks: spans.peaks,
      workday: shown === 'workday' ? knobs : station.demand.workday,
      offday: shown === 'offday' ? knobs : station.demand.offday,
    }),
    [spans.service, spans.peaks, knobs, shown, station.demand],
  )
  // Left axis scale: Σ open exits' inRate — the 人/时 the curve value multiplies in
  // `World.spawnStreet`. Closed exits contribute nothing, so they are left out.
  const baseRate = useMemo(
    () =>
      station.modules.reduce(
        (sum, m) => (m.type === 'exit' && m.cfg.open ? sum + Math.max(0, m.cfg.inRate) : sum),
        0,
      ),
    [station.modules],
  )

  /**
   * A grip moved: write the draft only. Each span keeps its own shape while it is being dragged
   * — a quarter of an hour at least, and inside the day — so the chart can never draw an
   * inverted band and the commit's own repair has nothing left to do.
   */
  const dragBoundary = (b: CurveBoundary, hours: number): void => {
    setSpanDraft(spanWith(spans, b, hours))
  }

  /**
   * Let go: the draft becomes the document. The three setters are each a no-op when their own
   * span did not move (`StationSlice` compares before committing), so one drag is one undo frame
   * and one worker rebuild whichever of the six boundaries it was.
   *
   * It takes the value it is committing rather than reading the draft state: a keyboard nudge is
   * a move *and* a release in one event, and state written in that event is not in this closure
   * yet.
   */
  const commitSpans = (draft: { service: TimeSpan; peaks: PeakWindows } | null = spanDraft): void => {
    if (draft === null) return
    setServiceWindow(draft.service.from, draft.service.to)
    setPeakWindow(0, draft.peaks[0].from, draft.peaks[0].to)
    setPeakWindow(1, draft.peaks[1].from, draft.peaks[1].to)
    setSpanDraft(null)
  }

  /** A keyboard nudge: move the boundary and commit it, from the spans this render holds. */
  const nudgeBoundary = (b: CurveBoundary, hours: number): void => {
    const next = spanWith(spans, b, hours)
    setSpanDraft(null)
    commitSpans(next)
  }

  const commitKnobs = (): void => {
    if (knobDraft === null) return
    setDemandKnobs(shown, knobDraft)
    setKnobDraft(null)
  }

  if (!open) return null

  const calendar = station.calendar
  const year = calendar.epoch.year
  const grid = monthGrid(year, month, calendar)
  // The two "now" readouts under the charts: the entrance rate is the curve value
  // times Σ open exits' inRate (the product `World.spawnStreet` draws from), the
  // train rate is every line's 下车 over its running headway. Both follow the
  // draft, so a grip drag or a 线路 edit moves the numbers with the curves.
  const nowEntry = Math.round(demandRate(simTime ?? 0, workday, input) * baseRate).toLocaleString('en-US')
  const nowTrain = Math.round(
    trainAlightPerHourAt(simTime ?? 0, station.lines, station.modules, spans.service, spans.peaks, workday),
  ).toLocaleString('en-US')

  return (
    <div className="timeModal" role="presentation">
      {/* The scrim is the way out of a *non-modal* window: the station stays visible behind it
          and a click anywhere outside the panel puts it away. It is a `button` so it is
          keyboard-reachable too, and every background state is reset so no `button` rule can
          tint the viewport. */}
      <button type="button" className="timeScrim" aria-label={t('close_time_window')} onClick={() => setTimePanel(false)} />
      <div className="timeWindow" role="dialog" aria-modal={false} aria-label={t('time_and_passengers')}>
        <div className="timeHead">
          <span className="timeTitle">{t('demand')}</span>
          <button type="button" className="timeClose" aria-label={t('close')} onClick={() => setTimePanel(false)}>
            ✕
          </button>
        </div>

        <div className="timeBody">
          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('entry_demand_curve')} · {dayName}</span>
              <span className="timeBlockNote">{t('entry_curve_note')}</span>
            </h4>
            <DayCurve
              input={input}
              workday={workday}
              simTime={simTime ?? 0}
              baseRate={baseRate}
              onDrag={dragBoundary}
              onDragEnd={() => commitSpans()}
              onNudge={nudgeBoundary}
            />
            <div className="curveSpans">
              <span>{t('now_about_value_people_h', translate(nowEntry))}</span>
            </div>
            <div className="knobs">
              <Knob
                label={t('morning_demand')}
                hint={t('peak_height_at_08_00')}
                value={knobs.amPeak}
                min={0}
                max={2.5}
                onDraft={(v) => setKnobDraft({ ...knobs, amPeak: v })}
                onCommit={commitKnobs}
              />
              <Knob
                label={t('evening_demand')}
                hint={t('peak_height_at_18_00')}
                value={knobs.pmPeak}
                min={0}
                max={2.5}
                onDraft={(v) => setKnobDraft({ ...knobs, pmPeak: v })}
                onCommit={commitKnobs}
              />
              <Knob
                label={t('peak_steepness')}
                hint={t('peak_width_100_0_85_hours')}
                value={knobs.sharpness}
                min={0.4}
                max={2}
                onDraft={(v) => setKnobDraft({ ...knobs, sharpness: v })}
                onCommit={commitKnobs}
              />
            </div>
          </section>

          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('train_demand_curve')} · {dayName}</span>
              <span className="timeBlockNote">{t('train_curve_note')}</span>
            </h4>
            <TrainCurve
              lines={station.lines}
              modules={station.modules}
              service={spans.service}
              peaks={spans.peaks}
              workday={workday}
              simTime={simTime ?? 0}
            />
            <div className="curveSpans">
              <span>{t('now_about_value_people_h', translate(nowTrain))}</span>
            </div>
            {/* The three spans' own times, under the train chart in one row: either plot
                carries the curves and the bands and no type at all. It follows the **draft**,
                so the numbers move with the grip being dragged. */}
            <div className="curveSpans">
              <span className="service">
                {t('service')}<b>{translate(`${clockTextOf(spans.service.from)}–${clockTextOf(spans.service.to)}`)}</b>
              </span>
              <span>
                {t('morning_peak')}<b>{translate(`${clockTextOf(spans.peaks[0].from)}–${clockTextOf(spans.peaks[0].to)}`)}</b>
              </span>
              <span>
                {t('evening_peak')}<b>{translate(`${clockTextOf(spans.peaks[1].from)}–${clockTextOf(spans.peaks[1].to)}`)}</b>
              </span>
            </div>
          </section>

          <section className="timeBlock">
            <h4 className="timeBlockHead">
              <span>{t('calendar')}</span>
              <span className="timeBlockNote">
                <button
                  type="button"
                  className="calNav"
                  aria-label={t('previous_month')}
                  disabled={month === 1}
                  onClick={() => setMonth((m) => Math.max(1, m - 1))}
                >
                  ‹
                </button>
                <span className="calTitle">{t('value_value', year, translate(MONTH_LABELS[month - 1]))}</span>
                <button
                  type="button"
                  className="calNav"
                  aria-label={t('next_month')}
                  disabled={month === 12}
                  onClick={() => setMonth((m) => Math.min(12, m + 1))}
                >
                  ›
                </button>
              </span>
            </h4>
            <div className="calGrid">
              {MONTH_GRID_HEADS.map((h) => (
                <span key={h} className="calHeadCell" aria-hidden="true">
                  {translate(h)}
                </span>
              ))}
              {grid.flat().map((cell, i) =>
                cell === null ? (
                  <span key={`blank-${i}`} className="calCell empty" />
                ) : (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={cellClass(cell, today?.date ?? null)}
                    aria-label={t('value_value_value', cell.date.month, cell.date.day, translate(DAY_TYPE_LABELS[cell.dayType]))}
                    aria-pressed={today !== null && sameDate(cell.date, today.date)}
                    onClick={() => seekToDate(cell.date)}
                  >
                    {translate(cell.date.day)}
                  </button>
                ),
              )}
            </div>
            <div className="calKeys">
              <span>
                <i className="calKey today" />
                {t('current_date')}</span>
              <span>
                <i className="calKey offday" />
                {t('offday')}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Whole minutes, to a five-minute grain: the drag's own unit, and what the document holds. */
function snap(seconds: number): number {
  return Math.round(seconds / 300) * 300
}

/**
 * `base` with one boundary moved to `hours`, clamped so each span stays a span — at least a
 * quarter of an hour long, inside the day — **and so the two peaks stay in order**: 早高峰's end
 * is walled by 晚高峰's start and 晚高峰's start by 早高峰's end, which is the same invariant
 * `normalizePeaks` holds on the way in. Shared by the drag and the keyboard nudge, so the two
 * cannot clamp differently.
 */
function spanWith(
  base: { service: TimeSpan; peaks: PeakWindows },
  b: CurveBoundary,
  hours: number,
): { service: TimeSpan; peaks: PeakWindows } {
  const seconds = snap(Math.max(0, Math.min(SERVICE_LATEST, hours * 3600)))
  const next: { service: TimeSpan; peaks: PeakWindows } = {
    service: { ...base.service },
    peaks: [{ ...base.peaks[0] }, { ...base.peaks[1] }],
  }
  const span = b.kind === 'service' ? next.service : next.peaks[b.index]
  if (b.end === 'from') {
    const floor = b.kind === 'peak' && b.index === 1 ? next.peaks[0].to : 0
    span.from = Math.max(floor, Math.min(seconds, span.to - SERVICE_MIN_SPAN))
  } else {
    const ceiling = b.kind === 'peak' && b.index === 0 ? next.peaks[1].from : SERVICE_LATEST
    span.to = Math.min(ceiling, Math.max(seconds, span.from + SERVICE_MIN_SPAN))
  }
  return next
}

function sameDate(a: SimDate, b: SimDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** A cell's classes: its day type, and the **one** highlight the grid carries —
 *  the day the station is standing on. Nothing else is marked: the run's own day 0 is where the
 *  clock started, which is not something the player picked or needs to find. */
function cellClass(cell: CalendarCell, today: SimDate | null): string {
  let cls = `calCell ${cell.dayType}`
  if (today && sameDate(cell.date, today)) cls += ' today'
  return cls
}
