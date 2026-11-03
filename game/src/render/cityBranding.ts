import { drawChengduLogo } from './chengduBranding.ts'
import { drawBeijingTrainMark } from './beijingTrainMark.ts'
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
  if (cityStyleFor(city).logo === 'chengdu') { drawChengduLogo(g,cx,cy,size);return }
  if (cityStyleFor(city).logo === 'beijing') { drawBeijingMetroMark(g,cx,cy,size,colour);return }
  if (cityStyleFor(city).logo === 'shanghai') { drawShanghaiMark(g,cx,cy,size,colour);return }
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
  const mark = style.trainMark ?? style.logo
  if (material.userData.cityTrainMark === mark) return
  const canvas = material.map?.image as HTMLCanvasElement | undefined
  const g = canvas?.getContext('2d')
  if (!g || !canvas || !material.map) return
  g.clearRect(0, 0, canvas.width, canvas.height)
  const width = canvas.width >= 256 ? 128 : canvas.width
  if (style.logo === 'chengdu') drawChengduLogo(g,canvas.width-width/2,canvas.height/2,width-10)
  else if (style.trainMark === 'beijing-calligraphy') drawBeijingTrainMark(g,canvas.width >= 256 ? width*1.5 : width/2,canvas.height/2,width-8,style.trainMarkColour)
  else drawMetroMark(g, width / 2, canvas.height / 2, (style.logo==='shanghai'?Math.min(width,canvas.height):canvas.height) - 10, style.logoColour, city)
  material.map.needsUpdate = true
  material.userData.cityLogo = style.logo
  material.userData.cityTrainMark = mark
}

/** Shanghai's broken circular S enclosing the joined M strokes. */
function drawShanghaiMark(g:CanvasRenderingContext2D,cx:number,cy:number,size:number,colour:string):void {
  g.save();g.translate(cx-size/2,cy-size/2);g.scale(size,size);g.fillStyle=colour
  g.beginPath();g.moveTo(.016,.628)
  g.bezierCurveTo(-.09,.2,.20,0,.50,0);g.bezierCurveTo(.75,0,.95,.17,.994,.412)
  g.lineTo(.837,.412);g.bezierCurveTo(.79,.24,.65,.155,.50,.155)
  g.bezierCurveTo(.31,.155,.17,.28,.151,.477);g.quadraticCurveTo(.15,.487,.17,.487)
  g.lineTo(.22,.487);g.lineTo(.363,.304);g.lineTo(.501,.445);g.lineTo(.608,.304)
  g.lineTo(.768,.488);g.lineTo(.989,.488);g.quadraticCurveTo(1,.488,1,.5)
  g.bezierCurveTo(1,.78,.78,1,.5,1);g.bezierCurveTo(.30,1,.11,.88,.041,.703)
  g.lineTo(.216,.703);g.bezierCurveTo(.29,.80,.39,.844,.5,.844)
  g.bezierCurveTo(.65,.844,.76,.76,.823,.629)
  g.lineTo(.709,.629);g.lineTo(.617,.526);g.lineTo(.501,.627);g.lineTo(.374,.527)
  g.lineTo(.281,.627);g.closePath();g.fill();g.restore()
}

/** Beijing station DC roundel, deliberately separate from the 北京 train wordmark. */
function drawBeijingMetroMark(g:CanvasRenderingContext2D,cx:number,cy:number,size:number,colour:string):void {
  g.save();g.translate(cx-size/2,cy-size/2);g.scale(size,size)
  g.strokeStyle=colour;g.lineWidth=.10;g.lineCap='butt'
  g.beginPath();g.arc(.5,.5,.45,0,Math.PI*2-.30);g.stroke()
  g.fillStyle=colour;g.beginPath();g.moveTo(.276,.256);g.lineTo(.70,.256)
  g.quadraticCurveTo(.84,.50,.70,.744);g.lineTo(.276,.744);g.closePath()
  g.moveTo(.388,.344);g.lineTo(.625,.344);g.quadraticCurveTo(.69,.50,.625,.656);g.lineTo(.388,.656);g.closePath()
  g.fill('evenodd');g.fillRect(.70,.50,.30,.10);g.restore()
}
