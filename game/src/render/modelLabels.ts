/** Fit decal ink by reducing font size, preserving letter proportions and margins. */
export function drawModelText(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number): void {
  g.save()
  const metrics = g.measureText(text)
  const inkWidth = Math.max(metrics.width, (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? 0))
  if (inkWidth > width) {
    g.font = g.font.replace(/([\d.]+)px/, (_, size: string) => `${Number(size) * width / inkWidth}px`)
  }
  g.fillText(text, x, y)
  g.restore()
}
