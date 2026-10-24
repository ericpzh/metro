export interface BenchmarkStats {
  averageFps: number
  onePercentLowFps: number
  worstFrameMs: number
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
