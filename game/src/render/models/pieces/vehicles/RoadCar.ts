import * as THREE from 'three'
import { INK, VehicleKit } from './VehicleKit.ts'

/** Compact crossover and low fastback, inside the existing 4.2 m queue envelope. */
export function buildRoadCar(k: VehicleKit, suv: boolean): void {
  const paint = suv ? INK.paint : INK.pale, roof = suv ? 1.64 : 1.43, belt = suv ? 1.03 : .88
  const axles = [-1.3, 1.3], r = suv ? .35 : .32
  k.loft(paint, [[-2.1, .73, .56, .88], [-1.75, .88, .61, belt], [.95, .89, .61, belt], [1.85, .82, .54, .84], [2.1, .73, .49, .72]])
  // Side skirts carry arch cutouts, keeping tires clear of a solid body block.
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape(); shape.moveTo(-2.02, .78); shape.lineTo(2.02, .78); shape.lineTo(2.02, .4)
    for (const y of [1.3, -1.3]) {
      shape.lineTo(y + .4, .4); shape.absarc(y, r, r + .055, .15, Math.PI - .15, false)
    }
    shape.lineTo(-2.02, .4); shape.closePath()
    const geo = k.low ? new THREE.ShapeGeometry(shape, 2) : new THREE.ExtrudeGeometry(shape, { depth: .045, bevelEnabled: false, curveSegments: 10 })
    geo.applyMatrix4(new THREE.Matrix4().set(0,0,1,side * .85, 1,0,0,0, 0,1,0,0, 0,0,0,1))
    if(k.low&&side<0){const ix=geo.index!;for(let i=0;i<ix.count;i+=3){const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b)}geo.computeVertexNormals()}
    k.add(paint, geo)
    for (const y of axles) k.wheel(side * .84, y, r, .19)
    k.box(INK.rubber, [side * .882, -.1, .42], [.025, 1.52, .075])
  }
  const rear = suv ? -1.48 : -1.62, front = .93, roofRear = suv ? -1.05 : -.65
  k.loft(INK.glass, [[rear, .77, belt, belt + .1], [roofRear, .68, belt, roof], [.35, .66, belt, roof], [front, .76, belt, belt + .06]])
  k.loft(paint, [[roofRear - .04, .69, roof - .02, roof + .08], [.32, .68, roof - .02, roof + .08], [.42, .65, roof - .05, roof + .035]])
  for (const s of [-1, 1]) {
    k.rod(paint, [s * .77, front, belt], [s * .66, .35, roof], .035)
    k.rod(paint, [s * .77, rear, belt], [s * .68, roofRear, roof], suv ? .065 : .043)
    k.rod(INK.rubber, [s * .777, -.35, belt], [s * .69, -.35, roof], .026)
    if (!k.low) k.rod(INK.metal, [s * .785, rear, belt], [s * .785, front, belt], .014)
    k.ellipsoid(paint, [s * .96, .69, belt + .06], [.135, .16, .065])
    if (!k.low) for (const y of [-.92, .25]) k.box(INK.accent, [s * .893, y, belt - .11], [.018, .19, .026])
    k.box(INK.glass, [s * .45, 2.112, .73], [.56, .025, .13])
    k.box(INK.lamp, [s * .46, 2.144, .76], [.48, .022, .035])
    k.box(INK.tail, [s * .5, -2.117, .79], [.48, .025, .065])
    if (suv) k.rod(INK.metal, [s * .55, -.99, roof + .13], [s * .55, .2, roof + .13], .021)
  }
  k.box(INK.glass, [0, 2.111, .52], [1.16, .025, .16])
  k.box(INK.metal, [0, 2.14, .54], [.5, .013, .085])
  k.box(INK.tail, [0, -2.105, .8], [1.1, .015, .025])
  k.box(INK.rubber, [0, -2.025, .45], [1.4, .09, .12])
  if (suv) k.box(INK.glass, [0, -1.14, roof + .075], [1.39, .25, .07])
}
