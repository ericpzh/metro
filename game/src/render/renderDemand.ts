/** Retain the last framebuffer until an input, camera or animation changes it. */
export class RenderDemand {
  continuous = false
  private dirty = true
  private view: number[] = []
  private projection: number[] = []

  invalidate(): void { this.dirty = true }

  needsFrame(view: ArrayLike<number>, projection: ArrayLike<number>, animating: boolean): boolean {
    const changed = (previous: number[], next: ArrayLike<number>) => previous.length !== next.length || previous.some((v, i) => Math.abs(v - next[i]) > 1e-7)
    if (!this.dirty && !this.continuous && !animating && !changed(this.view, view) && !changed(this.projection, projection)) return false
    this.view = Array.from(view); this.projection = Array.from(projection)
    this.dirty = false
    return true
  }
}
