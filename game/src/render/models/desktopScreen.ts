/** Desktop wallpaper and taskbar for furniture computers, separate from TVM UI. */
export function drawDesktopScreen(g: CanvasRenderingContext2D): void {
  const w = 256, h = 160
  g.fillStyle = '#07528b'
  g.fillRect(0, 0, w, h)
  // A blue light sweep and four bright panes read even in the small rail tile.
  for (let x = 0; x < w; x++) {
    const glow = Math.max(0, 1 - Math.abs(x - 175) / 180)
    g.fillStyle = `rgba(12,169,236,${glow * 0.6})`
    g.fillRect(x, 0, 1, h - 15)
  }
  g.fillStyle = '#6cdbff'
  for (const x of [151, 181]) for (const y of [47, 80]) g.fillRect(x, y, 27, 30)
  // Generic desktop shortcuts: file, browser and folder, each with a tiny caption.
  for (const [i, colour] of ['#f5f7fa', '#3dd1ae', '#ffd269'].entries()) {
    const y = 12 + i * 39
    g.fillStyle = colour
    g.fillRect(12, y, 14, 17)
    g.fillStyle = '#d9edf8'
    g.fillRect(8, y + 22, 24, 2)
  }
  g.fillStyle = '#102b47'
  g.fillRect(0, h - 15, w, 15)
  g.fillStyle = '#f3f7fb'
  for (const x of [6, 11]) for (const y of [149, 154]) g.fillRect(x, y, 4, 4)
  g.fillStyle = '#e3edf6'
  g.fillRect(23, 149, 56, 8)
  for (const [i, colour] of ['#3bbde7', '#ffd269', '#f4f7fb'].entries()) {
    g.fillStyle = colour
    g.fillRect(90 + i * 19, 149, 10, 8)
  }
  g.fillStyle = '#d9edf8'
  g.fillRect(223, 149, 24, 2)
  g.fillRect(229, 154, 18, 2)
}
