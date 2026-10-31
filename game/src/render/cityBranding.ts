import { cityStyleFor, type CityStyle } from '../sim/cityStyles.ts'
import type * as THREE from 'three'

/**
 * The 广州地铁 mark — the stylised 羊 the network wears. Two strokes rise from
 * the base, bend outward over their top half and run out to the upper corners,
 * with a narrow slot between them.
 *
 * The outline is traced from the reference artwork: the shape is 0.849 as wide
 * as it is tall, each stroke is 0.174 wide at the base, its inner edge sits
 * 0.455 of the way across, and the bend is the arc the strokes share (the
 * quadratics below stand in for it to within a pixel or two). One routine, so
 * the cab's nose and the exit banner wear the same mark rather than two
 * approximations of it.
 *
 * `cx, cy` is the centre of the mark's bounding box and `size` its height.
 */
export function drawMetroMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, colour: string, city?: CityStyle): void {
  if (cityStyleFor(city).logo === 'shenzhen') {
    drawShenzhenMark(g, cx, cy, size, colour)
    return
  }
  const w = size * 0.849
  const left = cx - w / 2
  const top = cy - size / 2
  // u across the mark (0..1), t up from its base (0..1); canvas y runs down.
  const X = (side: number, u: number): number => left + (side === 0 ? u : 1 - u) * w
  const Y = (t: number): number => top + (1 - t) * size
  g.fillStyle = colour
  for (const side of [0, 1]) {
    g.beginPath()
    g.moveTo(X(side, 0.455), Y(0))
    g.lineTo(X(side, 0.455), Y(0.5))
    g.quadraticCurveTo(X(side, 0.455), Y(0.833), X(side, 0.22), Y(1))
    g.lineTo(X(side, 0), Y(1))
    g.quadraticCurveTo(X(side, 0.281), Y(0.8), X(side, 0.281), Y(0.5))
    g.lineTo(X(side, 0.281), Y(0))
    g.closePath()
    g.fill()
  }
}


/** Symmetric Shenzhen emblem: paired uprights and two opposing rounded bowls. */
function drawShenzhenMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, colour: string): void {
  const width = size * .91
  const X = (x: number) => cx + (x - .5) * width
  const Y = (y: number) => cy + (y - .5) * size
  g.fillStyle = colour
  for (const flip of [false, true]) {
    const y = (v: number) => Y(flip ? 1 - v : v)
    g.beginPath()
    g.moveTo(X(0), y(0))
    g.bezierCurveTo(X(0), y(.25), X(.224), y(.455), X(.5), y(.455))
    g.bezierCurveTo(X(.776), y(.455), X(1), y(.25), X(1), y(0))
    g.lineTo(X(.845), y(0))
    g.bezierCurveTo(X(.845), y(.173), X(.69), y(.315), X(.5), y(.315))
    g.bezierCurveTo(X(.31), y(.315), X(.155), y(.173), X(.155), y(0))
    g.closePath(); g.fill()
  }
  for (const x of [.296, .55]) g.fillRect(X(x), Y(0), width * .155, size)
}

/** Repaint the scene-owned cab texture in place, retaining all live/prepared trains. */
export function refreshCityTrainMark(material: THREE.MeshBasicMaterial, city?: CityStyle): void {
  const style = cityStyleFor(city)
  if (material.userData.cityLogo === style.logo) return
  const canvas = material.map?.image as HTMLCanvasElement | undefined
  const g = canvas?.getContext('2d')
  if (!g || !canvas || !material.map) return
  g.clearRect(0, 0, canvas.width, canvas.height)
  drawMetroMark(g, canvas.width / 2, canvas.height / 2, canvas.height - 10, style.logoColour, city)
  material.map.needsUpdate = true
  material.userData.cityLogo = style.logo
}
