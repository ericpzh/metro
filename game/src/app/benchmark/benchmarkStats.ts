export interface BenchmarkStats {
  averageFps: number
  onePercentLowFps: number
  worstFrameMs: number
}

export interface FrameTimeSample {
  at: number
  interval: number
  tick: number
}

const FRAME_TIME_CEILINGS = [40, 60, 80, 100, 120, 160, 200, 300, 400, 600, 800, 1000] as const

/** Choose a clean 4-divisible Y-axis ceiling (ms) for a frame-generation-time chart. */
export function frameTimeCeilingFor(frames: readonly Pick<FrameTimeSample, 'interval'>[]): number {
  const measured = frames.length > 1 ? frames.slice(1) : frames
  let peak = 0
  for (let i = 0; i < measured.length; i++) {
    const interval = measured[i]!.interval
    if (Number.isFinite(interval) && interval > 0) peak = Math.max(peak, interval)
  }
  for (const step of FRAME_TIME_CEILINGS) {
    if (peak <= step) return step
  }
  return Math.ceil(peak / 200) * 200
}

/** Build an SVG polyline path of per-frame generation times (ms) across the benchmark window. */
export function frameTimePath(
  frames: readonly Pick<FrameTimeSample, 'at' | 'interval'>[],
  width: number,
  height: number,
  maxMs: number,
  durationMs = 30_000,
): string {
  const measured = frames.length > 1 ? frames.slice(1) : frames
  if (!measured.length || maxMs <= 0 || durationMs <= 0) return ''
  let hasPoint = false
  const commands: string[] = []
  for (let i = 0; i < measured.length; i++) {
    const frame = measured[i]!
    if (!Number.isFinite(frame.at) || !Number.isFinite(frame.interval) || frame.interval <= 0) continue
    const x = Math.min(width, Math.max(0, frame.at / durationMs * width))
    const ms = Math.min(maxMs, Math.max(0, frame.interval))
    const y = height - ms / maxMs * height
    commands.push(`${hasPoint ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    hasPoint = true
  }
  return commands.join(' ')
}

/** Summarize submitted-frame gaps using the shared browser benchmark protocol. */
export function summarizeFrameIntervals(intervals: readonly number[]): BenchmarkStats | null {
  const valid = intervals.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length === 0) return null
  const total = valid.reduce((sum, value) => sum + value, 0)
  const slowCount = Math.max(1, Math.ceil(valid.length * 0.01))
  const slowest = [...valid].sort((a, b) => b - a).slice(0, slowCount)
  return {
    averageFps: valid.length * 1000 / total,
    onePercentLowFps: 1000 / (slowest.reduce((sum, value) => sum + value, 0) / slowCount),
    worstFrameMs: Math.max(...valid),
  }
}
