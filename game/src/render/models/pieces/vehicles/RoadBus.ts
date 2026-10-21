import * as THREE from 'three'
import { INK, VehicleKit } from './VehicleKit.ts'

/** Two Guangzhou bus generations: pale/orange and red mosaic in the ambient grey palette. */
export function buildRoadBus(k: VehicleKit, mosaic: boolean): void {
  const paint = mosaic ? INK.accent : INK.pale, accent = mosaic ? INK.tail : INK.paint
  k.loft(paint, [[-5, 1.04, 1.04, 2.79], [-4.75, 1.17, 1.04, 2.9], [4.65, 1.17, 1.04, 2.9], [5, 1.06, 1.04, 2.74]])
  for (const end of [-1, 1]) k.loft(paint, [[end < 0 ? -5 : 4.76, 1.04, .57, 1.2], [end < 0 ? -4.76 : 5, 1.04, .57, 1.2]])
  for (const s of [-1, 1]) {
    const skirt = new THREE.Shape(); skirt.moveTo(-4.95, 1.09); skirt.lineTo(4.95, 1.09); skirt.lineTo(4.95, .37)
    for (const y of [3.04, -3.1]) {
      skirt.lineTo(y + .52, .37); skirt.absarc(y, .46, .52, -.17, Math.PI + .17, false)
    }
    skirt.lineTo(-4.95, .37); skirt.closePath()
    const geo = k.low ? new THREE.ShapeGeometry(skirt, 2) : new THREE.ExtrudeGeometry(skirt, { depth: .07, bevelEnabled: false, curveSegments: 12 })
    geo.applyMatrix4(new THREE.Matrix4().set(0,0,1,s > 0 ? 1.1 : -1.17, 1,0,0,0, 0,1,0,0, 0,0,0,1))
    if(k.low&&s<0){const ix=geo.index!;for(let i=0;i<ix.count;i+=3){const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b)}geo.computeVertexNormals()}
    k.add(accent, geo)
    k.box(INK.glass, [s * 1.176, -.05, 2.04], [.025, 8.98, 1.28])
    for (let y = -4.3; y < 4.6; y += k.low ? 1.5 : 1.14) k.box(paint, [s * 1.197, y, 2.04], [.022, .055, 1.29])
    k.box(INK.rubber, [s * 1.2, 0, 2.49], [.018, 9.05, .035])
    // Two pairs of full-height boarding doors on the right-hand curb side only.
    if (s === 1) for (const y of [.1, 3.79]) {
      k.box(INK.rubber, [1.213, y, 1.51], [.026, 1.14, 2.12])
      for (const d of [-1, 1]) {
        k.box(INK.glass, [1.23, y + d * .27, 1.65], [.018, .49, 1.73])
        k.rod(INK.metal, [1.244, y + d * .17, .87], [1.244, y + d * .17, 1.74], .012)
      }
      k.box(INK.metal, [1.24, y, .47], [.04, 1.14, .065])
    }
    for (const y of [-3.1, 3.04]) {
      k.wheel(s * 1.08, y, .46, .25)
      const archSegments = k.low ? 4 : 10
      for (let i = 0; i < archSegments; i++) {
        const a = i * Math.PI / archSegments, b = (i + 1) * Math.PI / archSegments
        if (k.low) {
          const x = s * 1.2
          const points: [number, number, number][] = [[x, y + Math.cos(a) * .565, .46 + Math.sin(a) * .565],
            [x, y + Math.cos(a) * .455, .46 + Math.sin(a) * .455],
            [x, y + Math.cos(b) * .455, .46 + Math.sin(b) * .455],
            [x, y + Math.cos(b) * .565, .46 + Math.sin(b) * .565]]
          k.panel(paint, s === 1 ? points.reverse() : points)
        } else k.rod(paint, [s * 1.2, y + Math.cos(a) * .51, .46 + Math.sin(a) * .51], [s * 1.2, y + Math.cos(b) * .51, .46 + Math.sin(b) * .51], .055)
      }
    }
    for (const [y, l] of [[-4.3, 1.3], [0, 4.95], [4.3, 1.2]]) {
      if (s === 1 && y >= 0) continue
      k.box(accent, [s * 1.16, y, .5], [.1, l, .27])
    }
    if (mosaic) {
      k.box(INK.pale, [s * 1.203, -1.75, 1.05], [.02, 1.04, .64])
      // Alternating broad panels and a diagonal are the reference's readable mosaic.
      const x = s * 1.217
      const points: [number, number, number][] = [[x, -1.2, .73], [x, -.15, 1.37], [x, -.15, .73]]
      k.panel(INK.glass, s === 1 ? points.reverse() : points)
      k.box(INK.paint, [s * 1.205, -4.32, 1.08], [.02, .55, .62])
    }
    for (let z = .85; z < 1.43; z += k.low ? .25 : .085) k.box(INK.glass, [s * 1.21, -4.25, z], [.025, .6, .025])
    k.rod(INK.rubber, [s * 1.05, 4.62, 2.65], [s * 1.39, 4.65, 2.65], .035)
    k.box(INK.rubber, [s * 1.37, 4.62, 2.33], [.16, .16, .5])
  }
  k.loft(INK.pale, [[-4.8, 1.05, 2.86, 3.01], [4.65, 1.04, 2.86, 3.01]])
  k.loft(accent, [[-2.7, .77, 3.0, 3.13], [-2.4, .82, 3.0, 3.31], [.9, .82, 3.0, 3.31], [1.2, .7, 3.0, 3.12]])
  k.box(INK.pale, [0, 2.7, 3.07], [1.15, .8, .15])
  for (let y = -2.2; y < -.6; y += k.low ? .32 : .2) k.box(INK.glass, [0, y, 3.318], [.9, .065, .014])
  k.box(INK.glass, [0, 5.006, 2.04], [2.01, .018, 1.32])
  k.box(INK.rubber, [0, 5.022, 2.54], [1.73, .018, .27])
  // LED route numerals are geometry, avoiding a texture allocation per vehicle.
  const segments = [
    [0, .07, .09, .013], [.047, .035, .013, .06], [.047, -.035, .013, .06],
    [0, -.07, .09, .013], [-.047, -.035, .013, .06], [-.047, .035, .013, .06], [0, 0, .09, .013],
  ]
  const digits = mosaic ? [[0,2,3,5,6], [0,1,2,3,4,5,6], [1,2]] : [[0,1,3,4,6], [1,2], [0,2,3,5,6]]
  digits.forEach((lit, i) => { for (const index of lit) {
    const [x,z,w,h] = segments[index], cx = (i-1)*.18+x, cz = 2.54+z
    if (k.low) k.panel(INK.lamp, [[cx-w/2,5.044,cz-h/2],[cx-w/2,5.044,cz+h/2],[cx+w/2,5.044,cz+h/2],[cx+w/2,5.044,cz-h/2]])
    else k.box(INK.lamp, [cx, 5.038, cz], [w,.012,h])
  } })
  k.box(accent, [0, 5.014, .99], [1.95, .025, .5])
  if (mosaic) {
    // Later red buses have a swept V-shaped mask below a taller black windscreen.
    k.panel(INK.glass, [[-1.04, 5.034, 1.38], [0, 5.09, 1.13], [1.04, 5.034, 1.38], [1.02, 5.034, 1.52], [-1.02, 5.034, 1.52]].reverse() as [number, number, number][])
    k.rod(paint, [-.96, 5.073, .98], [-.65, 5.073, .78], .035)
    k.rod(paint, [.96, 5.073, .98], [.65, 5.073, .78], .035)
  }
  k.box(INK.glass, [0, -5.012, 2.06], [1.87, .02, 1.08])
  for (const s of [-1, 1]) {
    k.rod(INK.rubber, [s * .08, 5.04, 1.44], [s * .79, 5.04, 1.62], .018)
    for (const x of [.7, .91]) {
      const z = mosaic ? .87 + (x - .7) : .88
      k.ellipsoid(INK.glass, [s * x, 5.041, z], [.105, .028, .09])
      k.ellipsoid(INK.lamp, [s * x, 5.066, z], [.06, .015, .052])
    }
    k.box(INK.tail, [s * .86, -5.03, 1.02], [.16, .025, .45])
  }
  for (const y of [-5.04, 5.05]) k.box(INK.metal, [0, y, .63], [.46, .018, .17])
}
