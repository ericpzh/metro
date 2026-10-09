// Printed safety vinyl on the platform face of the glass (§5.9).
export function drawPsdBand(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#b52630'
  g.fillRect(0, 0, 1024, 128)
  g.fillStyle = '#f5d62c'
  g.fillRect(0, 104, 1024, 24)
  g.fillStyle = '#fff4d8'
  g.textAlign = 'center'
  g.font = 'bold 36px "Microsoft YaHei", sans-serif'
  g.fillText('注意站台与列车之间的空隙', 512, 47)
  g.font = '24px sans-serif'
  g.fillText('Mind the gap between train and platform', 512, 86)
}

export function drawPsdDoorBand(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#f5d62c'
  g.fillRect(0, 0, 640, 128)
  g.fillStyle = '#b52630'
  g.fillRect(0, 104, 640, 24)
  g.fillStyle = '#171b1c'
  g.textAlign = 'center'
  g.font = 'bold 36px "Microsoft YaHei", sans-serif'
  g.fillText('注意站台与列车之间的空隙', 320, 47, 620)
  g.font = '22px sans-serif'
  g.fillText('Mind the gap', 320, 86)
}

export function drawPsdWarning(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#f8d923'
  g.beginPath()
  g.roundRect(6, 6, 628, 162, 18)
  g.fill()
  g.fillStyle = '#171b1c'
  g.textAlign = 'center'
  g.font = 'bold 33px "Microsoft YaHei", sans-serif'
  g.fillText('灯闪铃响，勿上下车。', 320, 57)
  g.fillText('冲门危险，顾己及人。', 320, 103)
  g.font = '19px sans-serif'
  g.fillText('Stand clear of closing doors', 320, 143)
  // A yellow caution character, matching the shape and palette of the reference.
  g.beginPath()
  g.moveTo(320, 188)
  g.quadraticCurveTo(355, 180, 412, 304)
  g.quadraticCurveTo(438, 365, 320, 370)
  g.quadraticCurveTo(202, 365, 228, 304)
  g.quadraticCurveTo(285, 180, 320, 188)
  g.fillStyle = '#f8d923'
  g.strokeStyle = '#171b1c'
  g.lineWidth = 14
  g.fill()
  g.stroke()
  for (const x of [284, 356]) {
    g.beginPath()
    g.ellipse(x, 285, 29, 34, 0, 0, Math.PI * 2)
    g.fillStyle = '#ffffff'
    g.fill()
    g.lineWidth = 5
    g.stroke()
    g.beginPath()
    g.arc(x + 5, 285, 17, 0, Math.PI * 2)
    g.fillStyle = '#171b1c'
    g.fill()
    g.beginPath()
    g.arc(x + 10, 278, 6, 0, Math.PI * 2)
    g.fillStyle = '#ffffff'
    g.fill()
  }
  g.beginPath()
  g.ellipse(320, 339, 12, 16, 0, 0, Math.PI * 2)
  g.fillStyle = '#171b1c'
  g.fill()
  g.fillStyle = '#f8d923'
  g.beginPath()
  g.roundRect(70, 383, 500, 82, 18)
  g.fill()
  g.fillStyle = '#b52630'
  g.font = 'bold 31px "Microsoft YaHei", sans-serif'
  g.fillText('小心！别碰我！', 320, 416)
  g.fillStyle = '#171b1c'
  g.font = '22px sans-serif'
  g.fillText('CAUTION! Do not touch', 320, 448)
}

export function drawPsdArrow(g: CanvasRenderingContext2D, sign: number): void {
  g.strokeStyle = '#ffffff'
  g.lineWidth = 9
  g.beginPath()
  g.arc(128, 128, 115, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.moveTo(128 + sign * 74, 128)
  g.lineTo(128 - sign * 46, 53)
  g.lineTo(128 - sign * 46, 203)
  g.closePath()
  g.fill()
}
