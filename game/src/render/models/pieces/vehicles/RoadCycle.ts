import { INK, VehicleKit, type Point } from './VehicleKit.ts'

export function buildRoadCycle(k: VehicleKit, bike: boolean): void {
  const r = bike ? .33 : .24, axle = bike ? .62 : .65
  for (const y of [-axle, axle]) k.wheel(0, y, r, bike ? .06 : .15, bike)
  if (bike) {
    // Low step-through frame and rear triangle, visible through open spoke wheels.
    for (const s of [-1, 1]) {
      const a: Point = [s * .055, -.62, r], b: Point = [s * .055, -.13, .35], c: Point = [s * .055, -.28, .85]
      k.rod(INK.paint, a, b, .028); k.rod(INK.paint, a, c, .025); k.rod(INK.paint, b, c, .035)
      k.rod(INK.paint, b, [s * .055, .22, .34], .045)
      k.rod(INK.paint, [s * .055, .22, .34], [s * .055, .47, 1.0], .045)
      k.rod(INK.paint, [s * .06, .62, r], [s * .06, .47, 1.0], .023)
    }
    k.box(INK.rubber, [0, -.3, .87], [.28, .28, .07])
    k.box(INK.paint, [0, -.25, .34], [.14, .63, .13])
    k.rod(INK.metal, [-.2, -.13, .34], [.2, -.13, .34], .025)
    for (const s of [-1, 1]) k.box(INK.rubber, [s * .22, -.13 + s * .1, .31], [.14, .17, .04])
    // Open wire basket, rather than a solid box in front of the rider.
    for (const z of [.96, 1.13]) {
      for (const x of [-.23, .23]) k.rod(INK.rubber, [x, .62, z], [x, .92, z], .012)
      for (const y of [.62, .92]) k.rod(INK.rubber, [-.23, y, z], [.23, y, z], .012, 8, y===.92&&z===1.13)
    }
    if(!k.low){
      for (let x = -.2; x <= .21; x += .1) for (const y of [.62, .92]) k.rod(INK.rubber, [x, y, .96], [x, y, 1.13], .007, 4)
      for (const y of [.65, .75, .85]) for (const x of [-.23, .23]) k.rod(INK.rubber, [x, y, .96], [x, y, 1.13], .007, 4)
    }
  } else {
    k.loft(INK.accent, [[-.89, .14, .3, .48], [-.67, .26, .3, .72], [-.08, .24, .3, .69], [.1, .18, .25, .36]])
    k.box(INK.rubber, [0, .1, .29], [.4, .73, .09])
    k.loft(INK.paint, [[.26, .18, .31, .61], [.48, .24, .38, .94], [.62, .18, .45, .98]])
    k.ellipsoid(INK.paint, [0, .65, .56], [.21, .31, .14])
    k.ellipsoid(INK.rubber, [0, -.38, .74], [.25, .42, .085])
    k.ellipsoid(INK.paint, [0, .5, 1.09], [.3, .15, .13])
    k.ellipsoid(INK.lamp, [0, .637, 1.1], [.19, .024, .07])
    k.box(INK.rubber, [0, -.77, .99], [.42, .36, .2])
    k.loft(INK.paint, [[-.95, .2, 1.0, 1.09], [-.9, .22, 1.0, 1.15], [-.6, .2, 1.0, 1.14]])
    k.box(INK.tail, [0, -.956, 1.06], [.3, .015, .06])
    for (const s of [-1, 1]) {
      k.rod(INK.metal, [s * .19, .57, r], [s * .19, .43, 1.04], .028)
      k.rod(INK.rubber, [s * .24, .49, 1.1], [s * .34, .51, 1.41], .014)
      k.ellipsoid(INK.glass, [s * .35, .51, 1.44], [.09, .035, .065])
    }
  }
  k.rod(INK.metal, [0, .45, .8], [0, .4, 1.13], .025)
  k.rod(INK.rubber, [-.32, .4, 1.13], [.32, .4, 1.13], .024)
  // Seated rider: bent knees, feet on pedals/deck, hands on the grips.
  const hip = bike ? .98 : .89
  k.ellipsoid(INK.glass, [0, -.22, hip], [.16, .19, .12])
  for (const s of [-1, 1]) {
    const knee: Point = [s * .18, .17, hip - .24], foot: Point = [s * .19, bike ? -.13 : .25, bike ? .35 : .38]
    k.rod(INK.glass, [s * .12, -.22, hip], knee, .075)
    k.rod(INK.glass, knee, foot, .06)
    k.ellipsoid(INK.rubber, [foot[0], foot[1] + .04, foot[2]], [.075, .14, .045])
    k.rod(INK.accent, [s * .17, -.09, hip + .43], [s * .23, .12, 1.22], .055)
    k.rod(INK.accent, [s * .23, .12, 1.22], [s * .29, .4, 1.13], .045)
    k.ellipsoid(INK.paint, [s * .29, .4, 1.13], [.045, .055, .04])
  }
  k.ellipsoid(INK.accent, [0, -.16, hip + .27], [.2, .14, .29])
  k.ellipsoid(INK.paint, [0, -.1, hip + .62], [.115, .12, .15])
  k.ellipsoid(INK.pale, [0, -.12, hip + .72], [.15, .15, .11])
}
