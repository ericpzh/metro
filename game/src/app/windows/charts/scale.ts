// The 数据 window's y-axis arithmetic, kept out of its `.tsx` so the suite can pin it
// (test rules 1 and 4: the arithmetic lives in a three-free module).

/**
 * The axis top above `max`: the next 1 / 2 / 5 × 10ⁿ, so every gridline label is a
 * round number. A zero or empty series keeps a 1-unit axis rather than letting the
 * plot divide by nothing.
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 2, 5]) {
    const candidate = step * magnitude
    if (candidate >= max) return candidate
  }
  return 10 * magnitude
}

/** The axis' labelled values, bottom to top: 0 and `count` even steps up to `top`. */
export function axisTicks(top: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (top * i) / count)
}

/** A labelled gridline: the value it stands at and what it prints. */
export interface AxisTick {
  value: number
  label: string
}

/**
 * The class axis' own gridlines for `letters` (A … F). The axis is the one drawn
 * **upside down**: a sample stores the letter's level-of-service order (A = 0), but a
 * plot is y-up, so the letters are placed at `top − index` — **A on top, F on the
 * bottom**, which is how the letter itself reads and what keeps a crowded station's
 * line hanging low. Returned bottom to top.
 */
export function losAxis(letters: readonly string[]): AxisTick[] {
  const top = letters.length - 1
  return letters.map((label, index) => ({ value: top - index, label })).reverse()
}

/** The y value a sample's level-of-service order is drawn at, against a `letters` axis. */
export function losValue(index: number, letters: readonly string[]): number {
  return letters.length - 1 - index
}
