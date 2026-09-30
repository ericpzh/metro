// Deterministic RNG. §7.6: seed + tick -> identical crowd.
//
// mulberry32. Every operation is 32-bit integer math via Math.imul, so the
// sequence is identical in Node and in the browser. There is exactly one of
// these in the simulation, and no unseeded randomness anywhere in sim/.

export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Next integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Next float in [a, b). */
  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }

  /** Picks an element. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /**
   * Non-homogeneous Poisson: returns how many events fired this tick given a
   * rate in events/hour. Keeps the fractional carry in the RNG stream so the
   * process stays deterministic without a second state word.
   */
  poissonHour(ratePerHour: number, dtSeconds: number): number {
    const lambda = (ratePerHour / 3600) * dtSeconds
    if (lambda <= 0) return 0
    // Small-lambda Knuth; rates here are always tiny per tick.
    const l = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > l && k < 64)
    return k - 1
  }

  get state(): number {
    return this.s
  }

  set state(v: number) {
    this.s = v >>> 0
  }
}

/** FNV-1a over a string, for stable cache keys and ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
