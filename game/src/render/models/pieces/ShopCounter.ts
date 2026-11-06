import * as THREE from 'three'
import { slab, plate, type ModelMaterials } from '../PieceBuilder.ts'
import { omitModelDetail, panelModelDetail, tubeModelDetail } from '../../modelDetail.ts'
import { counterVariant, counterLength, type CounterVariant } from '../../../sim/counters.ts'
import { stockBatch, stockSphere, stockCylinder, type StockPart } from './ShopStock.ts'

/** Modular counter bays join side by side. Customer side −y, staff side +y. */
export function buildShopCounter(g: THREE.Group, mats: ModelMaterials, value?: CounterVariant, run?: number): boolean {
  const variant = counterVariant(value)
  if (variant === 'checkout') return false
  const cafe = variant !== 'generic', pastry = variant === 'cafe-pastry'
  const length = counterLength(run), extension = length - 1, centre = extension / 2
  const part = (name: string, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const mesh = slab(g, mat, x, y, z, w, d, h); mesh.name = name; return mesh
  }
  const small = (name: string, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number) => {
    const mesh = part(name, mat, x, y, z, w, d, h); omitModelDetail(mesh); return mesh
  }
  part('counter-plinth', mats.darkSteel, centre, 0, .055, .91 + extension, .72, .11)
  part('counter-cabinet', cafe ? mats.woodDark : mats.white, centre, .01, .515, .94 + extension, .75, .85)
  part('counter-worktop', cafe ? mats.woodLight : mats.white, centre, 0, .975, .99 + extension, .86, .07)
  // Rear doors and recessed pulls read as cabinetry from the staff side.
  for (let bay = 0; bay < length; bay++) for (const offset of [-.235, .235]) {
    const x = bay + offset
    const door = part('counter-rear-door', cafe ? mats.wood : mats.white, x, .392, .53, .448, .025, .71)
    panelModelDetail(door)
    if (!cafe) omitModelDetail(door, true)
    small('counter-pull', mats.steel, x + (offset < 0 ? .16 : -.16), .412, .7, .014, .018, .12)
  }
  if (cafe) {
    // Dark coffee-bar frontage, timber fins and a quiet inset cream panel.
    for (let i = 0; i < length * 20 - 1; i++) small('counter-front-batten', mats.wood, -.45 + i * .05, -.378, .52, .018, .018, .76)
    part('cafe-fascia', mats.darkSteel, centre, -.398, .55, .6 + Math.min(extension * .4, .9), .025, .3)
    small('cafe-badge', mats.white, centre - .15, -.415, .55, .08, .008, .11)
    for (let i = 0; i < 3; i++) small('cafe-fascia-mark', mats.white, centre - .015 + i * .095, -.415, .55, .065, .008, .018)
  } else {
    for (const z of [.62, .69]) small('counter-metal-inlay', mats.steel, centre, -.37, z, .94 + extension, .018, .014)
    for (const x of [.25, .3]) small('counter-metal-inlay', mats.steel, x + extension, -.37, .52, .014, .018, .79)
  }
  const posX = cafe ? -.33 : -.14
  small('counter-pos-foot', mats.darkSteel, posX, .13, 1.027, .22, .19, .035)
  tubeModelDetail(part('counter-pos-stem', mats.steel, posX, .13, 1.15, .025, .03, .22))
  const posH = cafe ? 1.35 : 1.4
  part('counter-pos-housing', cafe ? mats.darkSteel : mats.white, posX, .13, posH - .11, cafe ? .23 : .34, .045, .22)
  plate(g, mats.desktopScreen, cafe ? .2 : .3, .18, posX, .154, posH - .11, Math.PI).name = 'counter-pos-screen'
  small('counter-payment-reader', mats.darkSteel, posX, -.25, 1.08, .115, .08, .14)
  const payment = plate(g, mats.desktopScreen, .085, .09, posX, -.293, 1.09, 0)
  payment.name = 'counter-payment-screen'; omitModelDetail(payment)
  if (!cafe) {
    small('counter-printer', mats.white, .3 + centre, .08, 1.09, .18, .22, .16)
    small('counter-printer-slot', mats.rubber, .3 + centre, .193, 1.12, .13, .006, .012)
  } else if (pastry) {
    // A hollow glazed display: pastries remain visible through front/top.
    const cx = .125 + centre, width = .65 + extension
    part('pastry-case-base', mats.steel, cx, -.08, 1.05, width, .56, .07)
    for (const z of [1.12, 1.29]) {
      const tray = part('pastry-case-tray', mats.woodLight, cx, -.08, z, width - .06, .48, .02); panelModelDetail(tray, 'z')
    }
    for (const x of [-.19, .44 + extension]) for (const y of [-.35, .19]) part('pastry-case-post', mats.darkSteel, x, y, 1.285, .018, .018, .43)
    part('pastry-case-glass-front', mats.glass, cx, -.35, 1.29, width - .04, .008, .4)
    for (const x of [-.19, .44 + extension]) part('pastry-case-glass-side', mats.glass, x, -.08, 1.29, .008, .52, .4)
    part('pastry-case-glass-top', mats.glass, cx, -.08, 1.494, width, .56, .012)
    const pastries: StockPart[] = []
    for (const z of [1.17, 1.34]) for (let i = 0; i < 3 + extension * 5; i++) for (const y of [-.22, .06]) {
      pastries.push({ x: -.07 + i * .19, y, z, w: .14, d: .13, h: .08, color: i % 2 ? 0x88503c : 0xe3ae67 })
    }
    stockBatch(g, mats.shelfGoods, 'counter-pastries', pastries, stockSphere())
  } else {
    const station = new THREE.Group()
    station.name = 'coffee-station'
    station.position.x = extension * .35
    // Build equipment in its own bay without stretching the machine or cups.
    const counterRoot = g
    g = station
    // Stainless espresso machine, dark brew groups, steam wand and cup warmer.
    part('espresso-drip-tray', mats.steel, .15, -.04, 1.05, .56, .38, .07)
    part('espresso-back', mats.darkSteel, .15, .095, 1.1875, .56, .1, .205)
    part('espresso-machine', mats.steel, .15, -.015, 1.36, .56, .29, .14)
    for (const x of [.015, .27]) {
      small('espresso-brew-group', mats.darkSteel, x, -.085, 1.235, .09, .08, .11)
      small('espresso-portafilter', mats.rubber, x, -.18, 1.2, .035, .15, .024)
      small('espresso-control', mats.blue, x, -.163, 1.365, .075, .008, .045)
    }
    small('espresso-steam-wand', mats.steel, .39, -.13, 1.18, .012, .012, .21)
    const cups: StockPart[] = [], coffee: StockPart[] = []
    for (const x of [-.02, .15, .32]) {
      cups.push({ x, y: .02, z: 1.465, w: .067, d: .067, h: .07, color: 0xf2eee1 })
      coffee.push({ x, y: .02, z: 1.5 - .004, w: .052, d: .052, h: .004, color: 0x563c2b })
    }
    for (const x of [.015, .27]) cups.push({ x, y: -.1, z: 1.12, w: .07, d: .07, h: .07, color: 0xf2eee1 })
    stockBatch(g, mats.shelfGoods, 'counter-cups', cups, stockCylinder())
    stockBatch(g, mats.shelfGoods, 'counter-coffee', coffee, stockCylinder())
    if (length > 1) {
      part('coffee-grinder-base', mats.darkSteel, .65, .05, 1.16, .18, .22, .3)
      part('coffee-grinder-hopper', mats.tintedGlass, .65, .05, 1.41, .17, .17, .18)
      small('coffee-grinder-spout', mats.steel, .65, -.09, 1.21, .07, .08, .04)
      const takeaway: StockPart[] = []
      for (let i = 0; i < 3; i++) takeaway.push({ x: extension * .65 + .08 + i * .1, y: -.16, z: 1.075, w: .075, d: .075, h: .13, color: 0xe4d9bb })
      stockBatch(g, mats.shelfGoods, 'takeaway-cups', takeaway, stockCylinder())
    }
    counterRoot.add(station)
  }
  return true
}
