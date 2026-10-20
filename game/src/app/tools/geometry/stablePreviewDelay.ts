/** Run one preview after its snapped cell has stayed stable for a short delay. */
type TimerHandle = ReturnType<typeof globalThis.setTimeout>
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle
type CancelTimer = (timer: TimerHandle) => void

export class StablePreviewDelay {
  private key: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private run: (() => void) | null = null
  private readonly delayMs: number
  private readonly schedule: ScheduleTimer
  private readonly cancel: CancelTimer

  constructor(
    delayMs = 100,
    schedule: ScheduleTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
    cancel: CancelTimer = timer => globalThis.clearTimeout(timer),
  ) {
    this.delayMs = delayMs
    this.schedule = schedule
    this.cancel = cancel
  }

  scheduleLatest(key: string, run: () => void): boolean {
    if (key === this.key && this.timer !== null) {
      this.run = run
      return false
    }
    this.clear()
    this.key = key
    this.run = run
    this.timer = this.schedule(() => {
      this.timer = null
      const latest = this.run
      this.key = null
      this.run = null
      latest?.()
    }, this.delayMs)
    return true
  }

  clear(): void {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
    this.key = null
    this.run = null
  }

  /** Run the pending callback now; useful when the owner must flush before a release. */
  flush(): void {
    if (this.timer === null) return
    this.cancel(this.timer)
    const latest = this.run
    this.timer = null
    this.key = null
    this.run = null
    latest?.()
  }
}
