import type { FloorMarkVariant } from '../sim/floorDecor.ts'

function arrow(g: CanvasRenderingContext2D, x: number, y: number, size: number, down = false): void {
  g.save()
  g.translate(x, y)
  if (down) g.rotate(Math.PI)
  g.beginPath()
  g.moveTo(0, -size / 2)
  g.lineTo(size / 2, 0)
  g.lineTo(size / 5, 0)
  g.lineTo(size / 5, size / 2)
  g.lineTo(-size / 5, size / 2)
  g.lineTo(-size / 5, 0)
  g.lineTo(-size / 2, 0)
  g.closePath()
  g.fill()
  g.restore()
}

/** Printed floor vinyl, transparent beyond its ink; canvas top points local +y (§9.5). */
export function drawFloorMark(g: CanvasRenderingContext2D, variant: FloorMarkVariant, line = { id: '5', name: '5号线', colour: '#c8102e' }): void {
  g.clearRect(0, 0, 768, 512)
  g.textAlign = 'center'
  if (variant === 'boarding') {
    g.fillStyle = '#303638'
    g.fillRect(0, 0, 768, 512)
    g.fillStyle = '#f5f5ed'
    for (const x of [80, 240, 528, 688]) {
      g.save(); g.translate(x, 256); g.scale(0.125, 1); arrow(g, 0, 0, 350); g.restore()
    }
    g.fillStyle = '#21b58b'
    g.save(); g.translate(384, 256); g.scale(0.125, 1); arrow(g, 0, 0, 400, true); g.restore()
  } else if (variant === 'waiting') {
    g.fillStyle = '#f3cf19'
    g.fillRect(0, 25, 768, 14)
    for (const x of [240, 510]) {
      g.fillRect(x, 39, 18, 455)
      for (const y of [190, 375]) for (const dx of [-46, 46]) {
        g.beginPath()
        g.ellipse(x < 300 ? 115 + dx : 655 + dx, y, 17, 38, dx < 0 ? -0.12 : 0.12, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.fillStyle = '#38bd77'
    arrow(g, 384, 210, 190, true)
    g.fillStyle = '#172522'
    g.font = 'bold 32px "Microsoft YaHei", sans-serif'
    g.fillText('下车区', 384, 170)
    g.fillStyle = '#f3cf19'
    g.font = 'bold 28px "Microsoft YaHei", sans-serif'
    g.fillText('先下后上', 384, 390)
    g.font = '22px sans-serif'
    g.fillText('Please queue', 384, 445)
  } else {
    const directionArrow = (inset: number): void => {
      g.beginPath()
      g.moveTo(384, inset)
      g.lineTo(768 - inset, 210)
      g.lineTo(580 - inset, 210)
      g.lineTo(580 - inset, 512 - inset)
      g.lineTo(188 + inset, 512 - inset)
      g.lineTo(188 + inset, 210)
      g.lineTo(inset, 210)
      g.closePath()
      g.fill()
    }
    g.fillStyle = '#28363d'
    directionArrow(0)
    g.fillStyle = line.colour
    directionArrow(8)
    g.fillStyle = '#ffffff'
    g.font = 'bold 65px "Microsoft YaHei", sans-serif'
    g.fillText(line.name, 384, 245, 330)
    g.font = 'bold 34px sans-serif'
    g.fillText(`Line ${line.id}`, 384, 310, 330)
  }
}
