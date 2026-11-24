import type { ReactElement } from 'react'
import type { TourLevelSwitchRecord } from './benchmarkCameraTour.ts'
import {
  frameTimeCeilingFor,
  frameTimePath,
  type BenchmarkStats,
  type FrameTimeSample,
} from './benchmarkStats.ts'
import type { benchmarkCopy } from './benchmarkCopy.ts'

const DEFAULT_DURATION_MS = 30_000
const TARGET_60_MS = 1000 / 60
const TARGET_30_MS = 1000 / 30

export interface FrameTimeArrival {
  at: number
  tick: number
}

export function FrameTimeChart({
  frames,
  arrivals,
  stats,
  copy,
  levelSwitches = [],
  durationMs = DEFAULT_DURATION_MS,
}: {
  frames: readonly FrameTimeSample[]
  arrivals: readonly FrameTimeArrival[]
  stats: BenchmarkStats
  copy: ReturnType<typeof benchmarkCopy>
  levelSwitches?: readonly TourLevelSwitchRecord[]
  durationMs?: number
}): ReactElement {
  const width = 1000
  const height = 260
  const viewHeight = 340
  const maxMs = frameTimeCeilingFor(frames)
  const yTicks = [0, Math.round(maxMs * 0.25), Math.round(maxMs * 0.5), Math.round(maxMs * 0.75), maxMs]
  const path = frameTimePath(frames, width, height, maxMs, durationMs)
  const y60 = height - TARGET_60_MS / maxMs * height
  const y30 = height - TARGET_30_MS / maxMs * height
  const meanMs = stats.averageFps > 0 ? 1000 / stats.averageFps : 0
  const low1Ms = stats.onePercentLowFps > 0 ? 1000 / stats.onePercentLowFps : 0

  return <div className="benchmarkChartWrap benchmarkFrameTimeWrap">
    <svg className="benchmarkChart" viewBox={`0 0 ${width} ${viewHeight}`} role="img" aria-label={copy.frameTimeChart}>
      {yTicks.map(ms => {
        const y = height - ms / maxMs * height
        return <g key={ms}>
          <line x1="0" x2={width} y1={y} y2={y} className="benchmarkGrid"/>
          <text x="-12" y={y + 4} className="benchmarkAxis" textAnchor="end">{ms}</text>
        </g>
      })}
      {[0, 5, 10, 15, 20, 25, 30].map(seconds => (
        <text key={seconds} x={seconds / 30 * width} y={height + 25} className="benchmarkAxis" textAnchor={seconds === 0 ? 'start' : seconds === 30 ? 'end' : 'middle'}>
          {seconds}{copy.secShort}
        </text>
      ))}
      {TARGET_30_MS < maxMs && <g>
        <line x1="0" x2={width} y1={y30} y2={y30} className="benchmarkFrameTarget benchmarkFrameTarget30"/>
        <text x={width - 4} y={Math.max(12, y30 - 5)} className="benchmarkFrameTargetLabel benchmarkFrameTargetLabel30" textAnchor="end">{copy.frameTimeTarget30}</text>
      </g>}
      {TARGET_60_MS < maxMs && <g>
        <line x1="0" x2={width} y1={y60} y2={y60} className="benchmarkFrameTarget benchmarkFrameTarget60"/>
        <text x={width - 4} y={Math.max(12, y60 - 5)} className="benchmarkFrameTargetLabel benchmarkFrameTargetLabel60" textAnchor="end">{copy.frameTimeTarget60}</text>
      </g>}
      {path && <path d={path} className="benchmarkFrameTimeLine"><title>{copy.frameTimeChart}</title></path>}
      {arrivals.map(({ at, tick }, index) => {
        const x = Math.min(width, Math.max(0, at / durationMs * width))
        return <g key={`${tick}-${index}`}>
          <line x1={x} x2={x} y1="0" y2={height} className="benchmarkArrival"/>
          <text x={Math.min(width - 42, x + 4)} y={14 + (index % 2) * 14} className="benchmarkArrivalLabel">{copy.tick} {tick}</text>
        </g>
      })}
      {levelSwitches.map(({ at, level, key }, index) => {
        const x = Math.min(width, Math.max(0, at / durationMs * width))
        return <g key={`lvl-${at}-${level}-${index}`}>
          <line x1={x} x2={x} y1="0" y2={height} className="benchmarkLevelSwitch"/>
          <text x={Math.min(width - 56, x + 4)} y={height - 6 - (index % 2) * 13} className="benchmarkLevelSwitchLabel">{key} {level}m</text>
        </g>
      })}
      <text x="0" y="-12" className="benchmarkAxisTitle">{copy.frameTimeAxis}</text>
      <text x={width / 2} y={height + 65} className="benchmarkAxisTitle" textAnchor="middle">{copy.secondsWall}</text>
    </svg>
    <div className="benchmarkFrameTimeLegend">
      <span className="benchmarkFrameTimeKey">{copy.frameTimeMean}: {meanMs.toFixed(1)} ms</span>
      <span>{copy.frameTimeLow1}: {low1Ms.toFixed(1)} ms</span>
      <span>{copy.frameTimeWorst}: {stats.worstFrameMs.toFixed(1)} ms</span>
    </div>
    <div className="benchmarkChartNote">{levelSwitches.length > 0 ? copy.tourFrameTimeNote : copy.frameTimeNote}</div>
  </div>
}
