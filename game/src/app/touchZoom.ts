/** A two-finger camera gesture owns the entire touch session, including its last release. */
export class TouchZoom {
  private points = new Map<number, { x: number; y: number }>()
  private pinched = false
  private distance = 0

  down(id: number, x: number, y: number): void {
    this.points.set(id, { x, y })
    if (this.points.size > 1) this.pinched = true
    this.distance = this.span()
  }

  move(id: number, x: number, y: number): number {
    if (!this.points.has(id)) return 1
    this.points.set(id, { x, y })
    const next = this.span()
    const factor = this.distance > 0 && next > 0 ? this.distance / next : 1
    this.distance = next
    return factor
  }

  up(id: number): boolean {
    if (!this.points.has(id)) return false
    const tap = !this.pinched
    this.points.delete(id)
    this.distance = this.span()
    if (this.points.size === 0) this.pinched = false
    return tap
  }

  cancel(id: number): void {
    this.pinched = true
    this.up(id)
  }

  private span(): number {
    if (this.points.size !== 2) return 0
    const [a, b] = [...this.points.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
}
