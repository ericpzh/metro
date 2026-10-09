import * as THREE from 'three'
import { PieceBuilder, slab, plate, plateOf, placeLocal, ownedMaterial, canvasTexture, drawMetroMark } from '../PieceBuilder.ts'
import type { Module } from '../../../sim/types.ts'
import { posterFor } from '../../../sim/billboards.ts'

/** Resolve from the live document so station and exit renames repaint the pillar. */
export function guideLabels(data: { name: string; modules: readonly Module[] }, mod: Extract<Module, { type: 'guidepost' }>) {
  const exit = data.modules.find((m) => m.type === 'exit' && m.id === mod.cfg.exitId)
  const exitLabel = exit?.type === 'exit' ? (exit.cfg.name || '').replace(/(?:出入口|出口|入口|口)$/u, '').trim() : ''
  return { station: data.name || '地铁站', exit: exit?.type === 'exit' ? exitLabel : '入口' }
}

/** Ink stays in the upper half of the four-metre column. */
export function guideFace(station: string, exit = 'C'): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 256; c.height = 2048
  const g = c.getContext('2d')!
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'
  const chars = Array.from(station)
  const step = 240 / Math.max(1, chars.length)
  g.font = 'bold 256px "Microsoft YaHei", sans-serif'
  const letter = g.measureText(exit)
  const letterWidth = Math.max(letter.width, letter.actualBoundingBoxLeft + letter.actualBoundingBoxRight)
  const letterHeight = (letter.actualBoundingBoxAscent ?? 0) + (letter.actualBoundingBoxDescent ?? 0)
  const faceWidth = Math.hypot(GUIDE_PLAN[1][0] - GUIDE_PLAN[0][0], GUIDE_PLAN[1][1] - GUIDE_PLAN[0][1])
  const inkWidth = Math.min(.18, faceWidth * .7) * (224 / 256) * letterWidth / Math.max(1, letterWidth, letterHeight)
  g.font = `${Math.min(160, step * .88)}px "Microsoft YaHei", sans-serif`
  chars.forEach((ch, i) => {
    const metrics = g.measureText(ch)
    const width = Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
    g.save(); g.translate(128, 0); g.scale(inkWidth / faceWidth * 256 / width, 1)
    g.fillText(ch, (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2, 18 + step / 2 + i * step)
    g.restore()
  })
  return c
}

/** Rear-face English reads downwards, with the entire word rotated clockwise. */
export function guideEnglishFace(station: string): HTMLCanvasElement {
  const width = GUIDE_PLAN[2][0] - GUIDE_PLAN[0][0]
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * (4 - GUIDE_LOGO_TOP) / width)
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  g.font = '100px "Microsoft YaHei", sans-serif'
  const metrics = g.measureText(station)
  const inkWidth = Math.max(1, metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
  const inkHeight = Math.max(1, (metrics.actualBoundingBoxAscent ?? 80) + (metrics.actualBoundingBoxDescent ?? 20))
  const size = 100 * Math.min(c.height * .9 / inkWidth, c.width * .78 / inkHeight)
  g.font = `${size}px "Microsoft YaHei", sans-serif`
  const fitted = g.measureText(station)
  g.translate(c.width / 2, c.height / 2); g.rotate(Math.PI / 2)
  g.fillText(station, ((fitted.actualBoundingBoxLeft ?? 0) - (fitted.actualBoundingBoxRight ?? 0)) / 2,
    ((fitted.actualBoundingBoxAscent ?? size * .8) - (fitted.actualBoundingBoxDescent ?? size * .2)) / 2)
  return c
}

/** Fit the actual glyph ink into a square with equal padding, preserving its aspect. */
export function guideExitLetterFace(exit: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  g.font = 'bold 256px "Microsoft YaHei", sans-serif'
  const metrics = g.measureText(exit)
  const width = Math.max(metrics.width, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight)
  const height = (metrics.actualBoundingBoxAscent ?? 0) + (metrics.actualBoundingBoxDescent ?? 0)
  const font = 256 * 224 / Math.max(1, width, height)
  g.font = `bold ${font}px "Microsoft YaHei", sans-serif`
  const fitted = g.measureText(exit)
  const x = 128 + ((fitted.actualBoundingBoxLeft ?? 0) - (fitted.actualBoundingBoxRight ?? 0)) / 2
  const y = 128 + ((fitted.actualBoundingBoxAscent ?? 0) - (fitted.actualBoundingBoxDescent ?? 0)) / 2
  g.fillText(exit, x, y)
  return c
}

/** Square artwork is mounted on its own square geometry, never on the tall text panel. */
export function guideTrainIconFace(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#1675bc'; g.fillRect(0, 0, 256, 256)
  g.strokeStyle = '#fff'; g.lineWidth = 9; g.strokeRect(12, 12, 232, 232)
  g.beginPath(); g.roundRect(80, 47, 96, 137, 22); g.stroke()
  g.fillStyle = '#fff'; g.fillRect(94, 70, 68, 50)
  g.beginPath(); g.moveTo(99, 184); g.lineTo(76, 220); g.moveTo(157, 184); g.lineTo(180, 220); g.stroke()
  return c
}

// Preserve depth and height; compress the cross-pillar width to a 30-degree nose.
export const GUIDE_WIDTH_SCALE = (.11547 + .23094) * Math.tan(Math.PI / 12) / .2
export const GUIDE_RED_SCALE = .75
export const GUIDE_PLAN: ReadonlyArray<readonly [number, number]> = [[-.2 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .11547 * GUIDE_RED_SCALE], [0, -.23094 * GUIDE_RED_SCALE], [.2 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .11547 * GUIDE_RED_SCALE]]
// Same heading as the red triangle: a narrower back edge sits forward of it,
// while the longer nose projects beyond it and changes the side-face angles.
export const GUIDE_YELLOW_PLAN: ReadonlyArray<readonly [number, number]> = [[-.17 * GUIDE_WIDTH_SCALE, .07], [0, -.49], [.17 * GUIDE_WIDTH_SCALE, .07]]
export const GUIDE_LOGO_BOTTOM = 3.02
export const GUIDE_LOGO_TOP = 3.46

function triangleColumn(material: THREE.Material, height: number, scale = 1, plan = GUIDE_PLAN): THREE.Mesh {
  const shape = new THREE.Shape()
  plan.forEach(([x, y], i) => i === 0 ? shape.moveTo(x * scale, y * scale) : shape.lineTo(x * scale, y * scale))
  shape.closePath()
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }), material)
}

function guideLogoFace(triangular = false, leftSide = false): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512
  const g = c.getContext('2d')!
  g.fillStyle = '#ffdc23'; g.fillRect(0, 0, 512, 512)
  const x = triangular ? leftSide ? 150 : 362 : 256
  drawMetroMark(g, x, 218, 140, '#26272a')
  g.fillStyle = '#26272a'; g.textAlign = 'center'; g.font = 'bold 36px "Microsoft YaHei", sans-serif'
  g.fillText('广州地铁', x, 342)
  return c
}

/** Five vertices form a horizontal pyramid: rectangular rear base and one mid-height nose. */
export function yellowPyramidGeometry(face?: 'left' | 'right'): THREE.BufferGeometry {
  const height = GUIDE_LOGO_TOP - GUIDE_LOGO_BOTTOM
  const [left, tip, right] = GUIDE_YELLOW_PLAN
  const points = [[left[0],left[1],0], [right[0],right[1],0], [right[0],right[1],height], [left[0],left[1],height], [tip[0],tip[1],height/2]]
  const triangles = face === 'left' ? [[0,4,3]] : face === 'right' ? [[1,2,4]] : [[0,4,3],[1,2,4],[3,4,2],[0,1,4],[0,3,2],[0,2,1]]
  const positions: number[] = [], uvs: number[] = []
  for (const triangle of triangles) for (const i of triangle) {
    positions.push(...points[i])
    // Both triangular side prints read upright, from the rear base towards the nose.
    const u = i === 4 ? 1 : 0
    uvs.push(face === 'right' ? 1 - u : u, i === 4 ? .5 : i >= 2 ? 1 : 0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2)); geo.computeVertexNormals()
  return geo
}

/** Attach one panel to each of the three prism faces, using the actual edge normal. */
function threeFaces(group: THREE.Group, scale: number, mat: THREE.Material | readonly THREE.Material[], bottom: number, top: number, name: string, plan = GUIDE_PLAN, squareSize?: number): void {
  for (let i = 0; i < 3; i++) {
    const a = plan[i], b = plan[(i + 1) % 3]
    const x = (a[0] + b[0]) * scale / 2, y = (a[1] + b[1]) * scale / 2
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const length = Math.hypot(dx, dy), nx = dy / length, ny = -dx / length
    const width = squareSize === undefined ? length * scale : Math.min(squareSize, length * scale * .7)
    const height = squareSize === undefined ? top - bottom : width
    const face = plate(group, mat instanceof THREE.Material ? mat : mat[i], width, height, x + nx * .001, y + ny * .001, (top + bottom) / 2, Math.atan2(nx, -ny))
    face.name = name
  }
}

export class GuidepostModel extends PieceBuilder {
  readonly kind = 'guidepost'
  build(mod: Extract<Module, { type: 'guidepost' }>): THREE.Group {
    const g = new THREE.Group(), mats = this.ctx.mats
    const base = triangleColumn(mats.darkSteel, .07, 1.14); base.name = 'guide-triangular-base'; g.add(base)
    const body = triangleColumn(mats.exitRed, GUIDE_LOGO_BOTTOM); body.name = 'guide-triangular-column'; g.add(body)
    const head = triangleColumn(mats.exitRed, 4 - GUIDE_LOGO_TOP); head.position.z = GUIDE_LOGO_TOP; g.add(head)
    // Trim only the rear strip to the yellow base, keeping the front nose full-depth.
    const middlePlan: ReadonlyArray<readonly [number, number]> = [[-.17 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .07 * GUIDE_RED_SCALE], GUIDE_PLAN[1], [.17 * GUIDE_WIDTH_SCALE * GUIDE_RED_SCALE, .07 * GUIDE_RED_SCALE]]
    const middle = triangleColumn(mats.exitRed, GUIDE_LOGO_TOP - GUIDE_LOGO_BOTTOM, 1, middlePlan)
    middle.name = 'guide-red-middle'; middle.position.z = GUIDE_LOGO_BOTTOM; g.add(middle)
    // Keep the heading fixed; alter the triangle itself to project the nose.
    // The narrower rear edge is recessed, as in the supplied top-down sketch.
    const collar = new THREE.Group(); collar.name = 'guide-yellow-logo-collar'
    const yellow = new THREE.Mesh(yellowPyramidGeometry(), mats.psu)
    yellow.position.z = GUIDE_LOGO_BOTTOM; collar.add(yellow); g.add(collar)
    const labels = guideLabels(this.ctx.data, mod); g.userData.guideLabels = labels
    const iconMat = typeof document === 'undefined' ? mats.blue : ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 256, c => c.drawImage(guideTrainIconFace(), 0, 0)) }))
    threeFaces(g, 1, iconMat, 2.31, 2.49, 'guide-square-train-icon', GUIDE_PLAN, .18)
    const letterMat = typeof document === 'undefined' ? mats.white : ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ transparent: true, map: canvasTexture(256, 256, c => c.drawImage(guideExitLetterFace(labels.exit), 0, 0)) }))
    threeFaces(g, 1, letterMat, 2.71, 2.89, 'guide-square-exit-letter', GUIDE_PLAN, .18)
    if (typeof document !== 'undefined') {
      const ink = guideFace(labels.station, labels.exit)
      const upper = ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ transparent: true, map: canvasTexture(256, 277, c => c.drawImage(ink, 0, 0, 256, 277, 0, 0, 256, 277)) }))
      const englishInk = guideEnglishFace(this.ctx.data.nameEn?.trim() || 'Metro Station')
      const rear = ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ transparent: true,
        map: canvasTexture(englishInk.width, englishInk.height, c => c.drawImage(englishInk, 0, 0)) }))
      threeFaces(g, 1, [upper, upper, rear], GUIDE_LOGO_TOP, 4, 'guide-station-face')
      const logo = ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, c => c.drawImage(guideLogoFace(), 0, 0)) }))
      plate(collar, logo, .34 * GUIDE_WIDTH_SCALE, GUIDE_LOGO_TOP - GUIDE_LOGO_BOTTOM, 0, .071, (GUIDE_LOGO_BOTTOM + GUIDE_LOGO_TOP) / 2, Math.PI).name = 'guide-metro-logo-face'
      for (const side of ['left', 'right'] as const) {
        const sideLogo = ownedMaterial(this.ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, c => c.drawImage(guideLogoFace(true, side === 'left'), 0, 0)) }))
        const face = new THREE.Mesh(yellowPyramidGeometry(side), sideLogo)
        face.name = 'guide-metro-logo-face'; face.position.z = GUIDE_LOGO_BOTTOM
        face.position.x = side === 'left' ? -.001 : .001; face.position.y = -.0004
        collar.add(face)
      }
    }
    return placeLocal(g, mod)
  }
}

function routeFace(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 256; c.height = 768
  const g = c.getContext('2d')!
  g.fillStyle = '#9bd058'; g.fillRect(0, 0, 256, 768)
  g.fillStyle = '#f4f3e9'; g.fillRect(0, 0, 256, 120)
  g.fillStyle = '#173f35'; g.font = 'bold 30px "Microsoft YaHei", sans-serif'; g.textAlign = 'center'
  g.fillText(name, 128, 50, 236); g.font = '24px sans-serif'; g.fillText('公交站', 128, 92)
  for (let row = 0; row < 6; row++) {
    const y = 155 + row * 86
    g.fillStyle = '#216549'; g.fillRect(8, y, 46, 56)
    g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText(String([24, 79, 288, 303, 309, 964][row]), 31, y + 32)
    g.strokeStyle = '#397f42'; g.lineWidth = 2
    g.beginPath(); g.moveTo(64, y + 22); g.lineTo(240, y + 22); g.stroke()
    for (let x = 72; x < 240; x += 21) { g.beginPath(); g.arc(x, y + 22, 3, 0, Math.PI * 2); g.stroke() }
    g.fillStyle = '#427339'; g.fillRect(65, y + 40, 173, 3)
  }
  g.fillStyle = '#173f35'; g.fillRect(0, 692, 256, 76)
  g.fillStyle = '#fff'; g.font = '23px "Microsoft YaHei", sans-serif'; g.fillText('候车  ·  文明出行', 128, 738)
  return c
}

export class BusstopModel extends PieceBuilder {
  readonly kind = 'busstop'
  build(mod: Extract<Module, { type: 'busstop' }>): THREE.Group {
    const g = new THREE.Group(), ctx = this.ctx
    const green = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0x18574d, roughness: .65 }))
    const cream = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: 0xd8d9c5 }))
    const cx = (mod.w - 1) / 2, cy = .5, width = mod.w - .12
    // Canopy stays inside the reserved 4×2 / 8×2 footprint.
    slab(g, green, cx, cy, 2.94, width, 1.88, .12)
    slab(g, cream, cx, cy, 2.865, width - .12, 1.72, .03)
    slab(g, ctx.mats.orange, cx, -.425, 2.96, width, .025, .065)
    const posts = mod.cfg.variant === 'long' ? [0, 1.15, 4.4, mod.w - 1] : [0, 1.15, mod.w - 1]
    for (const x of posts) {
      slab(g, green, x, 1.12, 1.45, .14, .14, 2.9)
      slab(g, ctx.mats.darkSteel, x, 1.12, .035, .25, .25, .07)
      const brace = slab(g, green, x, .77, 2.62, .075, .8, .075)
      brace.rotation.x = -.4
    }
    slab(g, green, cx, 1.12, 2.38, width, .14, .15)
    // Slim route information cabinet at one end.
    slab(g, green, .53, 1.10, 1.35, .95, .18, 2.2)
    if (typeof document !== 'undefined') {
      const mat = ownedMaterial(ctx, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 768, (c) => c.drawImage(routeFace(ctx.data.name || '地铁站'), 0, 0)) }))
      plate(g, mat, .76, 1.91, .53, .998, 1.35, 0)
    } else slab(g, ctx.mats.green, .53, .995, 1.35, .76, .02, 1.91)
    const poster = posterFor(mod.cfg.poster)
    const panels = mod.cfg.variant === 'long' ? [[2.75, 2.8], [6.1, 2.6]] : [[2.13, 1.63]]
    for (const [x, w] of panels) {
      slab(g, green, x, 1.1, 1.53, w + .14, .18, 1.65)
      slab(g, ctx.mats.black, x, .998, 1.53, w + .04, .025, 1.55)
      if (ctx.ads) {
        const face = ctx.ads.adFace(poster.slug, w, 1.45)
        const ad = plateOf(g, face.geometry, face.material, x, .978, 1.53, 0)
        ad.userData.adPoster = poster.slug
      }
      slab(g, ctx.mats.steel, x, .35, .48, w * .8, .36, .065)
      for (const dx of [-w * .28, w * .28]) slab(g, green, x + dx, .35, .23, .1, .28, .46)
    }
    return placeLocal(g, mod)
  }
}
