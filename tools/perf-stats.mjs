// Shared report format. No timing assertions: host/GPU/load are part of a run.
export function summarize(values) {
  if (!values.length) throw new Error('benchmark collected no samples')
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1]
  return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1) }
}

export function printTimings(timings) {
  console.table(Object.fromEntries(Object.entries(timings).map(([name, stats]) => [name,
    Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, key === 'samples' ? value : +value.toFixed(2)]))])))
}
