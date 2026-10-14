/** Coalesce expensive pointer previews to the latest input in each frame.
 * Flush before release so the final sweep/section move is never lost (§9.5). */
export class FrameTask {
  private handle = 0
  private task: (() => void) | null = null
  private request: (callback: FrameRequestCallback) => number
  private cancelRequest: (handle: number) => void

  constructor(request = (callback: FrameRequestCallback) => requestAnimationFrame(callback), cancel = (handle: number) => cancelAnimationFrame(handle)) {
    this.request = request
    this.cancelRequest = cancel
  }

  schedule(task: () => void): void {
    this.task = task
    if (!this.handle) this.handle = this.request(() => { this.handle = 0; this.flush() })
  }

  flush(): void {
    if (this.handle) this.cancelRequest(this.handle)
    this.handle = 0
    const task = this.task
    this.task = null
    task?.()
  }

  cancel(): void {
    if (this.handle) this.cancelRequest(this.handle)
    this.handle = 0
    this.task = null
  }
}
