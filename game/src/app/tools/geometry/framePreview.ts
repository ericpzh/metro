type ScheduleFrame = (run: () => void) => () => void

function scheduleFrame(run: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(run)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(run, 0)
  return () => clearTimeout(id)
}

/** Latest target once per frame; changing targets never restarts the wait (§9.5). */
export class FramePreview {
  private key: string | null = null
  private run: (() => void) | null = null
  private cancel: (() => void) | null = null
  private readonly schedule: ScheduleFrame

  constructor(schedule: ScheduleFrame = scheduleFrame) { this.schedule = schedule }

  scheduleLatest(key: string, run: () => void): boolean {
    if (key === this.key && !this.cancel) return false
    const changed = key !== this.key
    this.key = key
    this.run = run
    if (!this.cancel) this.cancel = this.schedule(() => {
      this.cancel = null
      const latest = this.run
      this.run = null
      latest?.()
    })
    return changed
  }

  clear(): void {
    this.cancel?.()
    this.cancel = null
    this.key = null
    this.run = null
  }

  flush(): void {
    if (!this.cancel) return
    this.cancel()
    this.cancel = null
    const latest = this.run
    this.run = null
    latest?.()
  }
}
