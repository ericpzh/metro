import * as THREE from 'three'
import { slab, type ModelMaterials } from '../PieceBuilder.ts'
import { panelModelDetail, omitModelDetail, tubeModelDetail } from '../../modelDetail.ts'
import { shelfSpec, type ShelfVariant } from '../../../sim/shelves.ts'
import { stockBatch, stockSphere, stockCylinder, stockBanana, shirtGeometry, type StockPart } from './ShopStock.ts'

const outfits = [0xe6d8be, 0x9aafaa, 0x404e64, 0xc17b73, 0xf1e8d8, 0x7e89a4]
const food = [0xd45c3f, 0xe8bb4f, 0x699c6a, 0x73b5bf, 0xb67856, 0xe5d4a7]

/** All dimensions are local metres; the owning shelf builder applies edge/rotation. */
export function buildShopShelf(g: THREE.Group, mats: ModelMaterials, variant: ShelfVariant): boolean {
  if (!variant.startsWith('clothing-') && !variant.startsWith('food-') && !variant.startsWith('fruit-') && variant !== 'ice-cream' && variant !== 'cafe-backbar') return false
  const { height: h, depth: d } = shelfSpec(variant)
  const boxes: StockPart[] = [], round: StockPart[] = [], jars: StockPart[] = [], bananas: StockPart[] = [], detail: StockPart[] = [], shirts: StockPart[] = []
  const add = (list: StockPart[], x: number, y: number, z: number, w: number, depth: number, height: number, color: number, turn = 0) => list.push({ x, y, z, w, d: depth, h: height, color, turn })
  const board = (name: string, x: number, y: number, z: number, w: number, depth: number, height: number, mat: THREE.Material = mats.woodLight) => {
    const mesh = slab(g, mat, x, y, z, w, depth, height); mesh.name = name
    if (height < .06) panelModelDetail(mesh, 'z')
    if (name === 'fixture-upright' || name === 'table-riser' || name === 'freezer-red-rim') tubeModelDetail(mesh)
    if (name === 'freezer-side') panelModelDetail(mesh, 'x')
    if (name === 'freezer-wall' || name === 'freezer-front-badge') panelModelDetail(mesh)
    if (name === 'freezer-well' || name === 'freezer-handle' || name === 'freezer-basket') omitModelDetail(mesh, true)
    return mesh
  }
  const frame = (height: number, white = false) => {
    for (const x of [-.44, .44]) for (const y of [-d / 2 + .045, d / 2 - .045]) {
      board('fixture-upright', x, y, height / 2, .032, .032, height, white ? mats.white : mats.darkSteel)
    }
  }
  const folded = (x: number, y: number, z: number, color: number, count = 4) => {
    for (let k = 0; k < count; k++) {
      add(boxes, x + (k % 2) * .006, y, z + .018 + k * .037, .245, .22, .033, color)
      add(detail, x, y - .112, z + .019 + k * .037, .17, .003, .008, 0xf4ead9)
    }
  }
  const garments = (rail: number, wall: boolean) => {
    board('clothing-hanging-rail', 0, 0, rail, .848, .022, .022, wall ? mats.darkSteel : mats.steel)
    for (let i = 0; i < 7; i++) {
      const x = -.345 + i * .115
      add(shirts, x, 0, rail - .65, wall ? .6 : .67, 1, wall ? .9 : 1, outfits[i % outfits.length]!, 1.08)
      // Wooden triangular hangers and metal hooks remain visibly separate from fabric.
      for (const side of [-1, 1]) {
        const bar = board('hanger-shoulder', x, side * .065, rail - .052, .014, .15, .012, mats.woodLight)
        bar.rotation.x = side * .38
        bar.rotation.z = -.49
        omitModelDetail(bar, true)
      }
      add(detail, x, 0, rail - .015, .008, .008, .035, 0xb8bdbe)
    }
  }
  if (variant === 'cafe-backbar') {
    // Prep worktop below a shallower open hutch. Separate pieces meet at their
    // edges: no rear header or shelf end duplicates the cabinet's outer skin.
    board('backbar-plinth', 0, .015, .04, .9, .51, .08, mats.darkSteel)
    board('backbar-cabinet', 0, .015, .475, .94, .53, .79, mats.white)
    board('backbar-worktop', 0, 0, .9, .96, d, .06, mats.woodLight)
    for (const x of [-.225, .225]) {
      const door = board('backbar-lower-door', x, -.2625, .475, .435, .025, .71, mats.white)
      panelModelDetail(door)
      add(detail, x, -.2825, .75, .14, .015, .012, 0x626d72)
    }
    for (const x of [-.455, .455]) {
      const side = board('backbar-side', x, .15, 1.52, .035, .3, 1.18, mats.darkSteel)
      panelModelDetail(side, 'x')
    }
    const back = board('backbar-back', 0, .2875, 1.52, .875, .025, 1.18, mats.darkSteel)
    panelModelDetail(back)
    board('backbar-cap', 0, .15, h - .02, .945, .3, .04, mats.darkSteel)
    const levels = [1.32, 1.61, 1.9]
    levels.forEach((level, row) => {
      board('backbar-stock-deck', 0, .14375, level, .875, .2625, .025, mats.woodLight)
      const bottom = level + .0125, top = levels[row + 1] === undefined ? h - .04 : levels[row + 1]! - .0125
      for (const x of [-.145, .145]) {
        const divider = board('backbar-cubby-divider', x, .14375, (bottom + top) / 2, .02, .2625, top - bottom, mats.darkSteel)
        panelModelDetail(divider, 'x')
      }
      // Stacked saucers and small white cups fill the left cubby.
      for (let i = 0; i < 5; i++) add(jars, -.29, .14, bottom + .008 + i * .015, .17, .17, .012, 0xe8e6de)
      for (const x of [-.055, .06]) {
        add(jars, x, .13, bottom + .073, .075, .075, .14, row % 2 ? 0xe9e1cf : 0x815c3e)
        add(jars, x, .13, bottom + .148, .079, .079, .014, 0xb5a178)
        add(detail, x, .0905, bottom + .075, .047, .004, .055, 0xeee6cf)
      }
      for (const x of [.23, .355]) {
        add(jars, x, .13, bottom + .065, .067, .067, .13, row % 2 ? 0x85965f : 0x72503d)
        add(jars, x, .13, bottom + .145, .027, .027, .03, 0x9c8656)
        add(jars, x, .13, bottom + .165, .031, .031, .01, 0x383e3e)
        add(detail, x, .095, bottom + .065, .043, .004, .065, 0xe7dfc5)
      }
    })
    // Kettle, compact grinder and prep jars leave a clear working edge in front.
    board('backbar-kettle-base', -.28, .03, .94, .18, .18, .02, mats.steel)
    add(round, -.28, .03, 1.03, .16, .16, .18, 0xe5e6de)
    add(jars, -.28, .03, 1.125, .11, .11, .015, 0x3f4545)
    add(detail, -.375, .03, 1.04, .07, .035, .04, 0xe5e6de)
    board('backbar-prep-machine', .05, .12, 1.065, .18, .19, .27, mats.darkSteel)
    board('backbar-prep-tray', .05, -.02, .95, .18, .09, .04, mats.steel)
    add(detail, .05, .021, 1.13, .1, .008, .055, 0x407b9d)
    for (const x of [.27, .37]) {
      add(jars, x, .05, 1.01, .075, .075, .16, 0xc1a578)
      add(jars, x, .05, 1.095, .08, .08, .01, 0x3f4545)
    }
  } else if (variant === 'clothing-rail' || variant === 'clothing-wall') {
    const wall = variant === 'clothing-wall'
    frame(wall ? h - .036 : h, !wall)
    board('clothing-base-deck', 0, 0, .12, .91, d - .04, .035)
    if (wall) {
      board('clothing-top-deck', 0, 0, h - .018, .94, d, .036)
      garments(.84, true); garments(1.64, true)
      folded(-.25, 0, 1.77, outfits[0]!, 3); folded(.08, 0, 1.77, outfits[2]!, 3)
      // Top stacks sit below an open top frame, keeping the 1.95 m envelope.
      board('clothing-top-deck', 0, 0, 1.75, .88, d - .06, .025)
    } else {
      for (const x of [-.44, .44]) board('clothing-top-end-bar', x, 0, h - .016, .032, d - .122, .032, mats.white)
      garments(h - .016, false)
      for (const x of [-.44, .44]) board('clothing-foot', x, 0, .025, .065, d, .05, mats.white)
    }
  } else if (variant === 'clothing-table') {
    frame(.7425, true)
    for (const [z, w, depth] of [[.18, .91, d - .04], [.76, .94, d], [1.025, .6, .28]]) {
      board('folded-clothing-deck', 0, z > 1 ? .18 : 0, z, w, depth, z > 1 ? .05 : .035, mats.white)
    }
    for (const x of [-.25, .25]) for (const y of [-.2, .16]) folded(x, y, .78, outfits[(x < 0 ? 0 : 3) + (y < 0 ? 0 : 1)]!)
    for (const x of [-.25, .25]) folded(x, -.12, .2, outfits[x < 0 ? 2 : 5]!, 5)
    for (const x of [-.27, .27]) board('table-riser', x, .3, .88875, .018, .018, .2225, mats.white)
  } else if (variant === 'clothing-shoes') {
    frame(h - .04)
    for (const z of [.14, .52, .9, h - .02]) board('shoe-display-deck', 0, 0, z, .94, d, .04)
    for (const z of [.19, .57, .95]) for (let pair = 0; pair < 3; pair++) for (const foot of [-1, 1]) {
      const x = -.3 + pair * .3 + foot * .056
      add(round, x, -.035, z + .04, .088, .245, .09, outfits[pair + 2]!)
      add(boxes, x, -.02, z, .09, .245, .018, 0xe9dfcc)
      add(detail, x, -.04, z + .08, .035, .07, .012, 0xf5f0e3)
    }
    for (const x of [-.27, .05, .3]) {
      add(boxes, x, .17, 1.02, .18, .15, .2, x < 0 ? 0xa66e4d : 0x3f5051)
      const handle = new THREE.Mesh(new THREE.TorusGeometry(.055, .008, 5, 12, Math.PI), mats.woodDark)
      handle.rotation.x = Math.PI / 2; handle.position.set(x, .17, 1.12); handle.name = 'bag-handle'; omitModelDetail(handle); g.add(handle)
    }
  } else if (variant === 'food-snacks' || variant === 'food-bakery') {
    const bakery = variant === 'food-bakery'
    frame(h)
    board('food-back', 0, d / 2 - .025, (h - .16) / 2, .848, .025, h - .16, bakery ? mats.wood : mats.shelfPanel)
    for (let row = 0; row < 4; row++) {
      const z = .14 + row * (bakery ? .32 : .35)
      board('food-deck', 0, -.015, z, .91, d - .04, .035, bakery ? mats.woodLight : mats.white)
      board('food-price-strip', 0, -d / 2 + .015, z + .025, .9, .025, .05, bakery ? mats.woodDark : mats.blue)
      for (let i = 0; i < 5; i++) {
        const x = -.35 + i * .175
        add(detail, x, -d / 2 - .001, z + .026, .08, .004, .025, 0xf6f0dc)
        for (let lane = 0; lane < 2; lane++) {
          const y = -d / 2 + .12 + lane * .19
          if (bakery) {
            add(round, x, y, z + .085, .14, .17, .1, row % 2 ? 0xc88a42 : 0xe7b368)
            for (let k = 0; k < 3; k++) add(detail, x - .035 + k * .035, y, z + .133, .008, .095, .005, 0xf6d79e, -.3)
          } else {
            add(boxes, x, y, z + .13, .135, .1, .22, food[(i + row) % food.length]!, (i % 2 ? 1 : -1) * .04)
            add(detail, x, y - .053, z + .15, .095, .005, .075, 0xffedcc)
            add(detail, x, y - .057, z + .09, .062, .003, .015, 0x694936)
          }
        }
      }
    }
    board('food-header', 0, d / 2 - .04, h - .08, .848, .055, .16, bakery ? mats.woodDark : mats.gateRed)
    for (const x of [-.2, 0, .2]) add(detail, x, d / 2 - .071, h - .08, .12, .006, .027, 0xf6e6bb)
  } else if (variant === 'ice-cream') {
    // Open cavity, four insulated side walls, two sliding glass lids and red rim.
    board('freezer-plinth', 0, 0, .07, .88, d - .07, .14, mats.darkSteel)
    board('freezer-well', 0, 0, .23, .84, d - .12, .16, mats.white)
    for (const x of [-.45, .45]) board('freezer-side', x, 0, .53, .06, d, .78, mats.white)
    for (const y of [-d / 2 + .03, d / 2 - .03]) board('freezer-wall', 0, y, .53, .84, .06, .78, mats.white)
    for (const y of [-d / 2 + .025, d / 2 - .025]) board('freezer-red-rim', 0, y, h - .03, .96, .05, .06, mats.gateRed)
    for (const x of [-.455, .455]) board('freezer-red-rim', x, 0, h - .03, .05, d - .1, .06, mats.gateRed)
    for (const x of [-.215, .215]) {
      board('freezer-sliding-glass', x, 0, .927, .41, d - .12, .012, mats.glass)
      board('freezer-lid-rail', x + .205, 0, .94, .014, d - .1, .025, mats.steel)
      board('freezer-handle', x, -.16, .951, .12, .025, .024, mats.white)
      for (const y of [-.16, .14]) {
        board('freezer-basket', x, y, .63, .38, .27, .025, mats.steel)
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          add(boxes, x - .12 + i * .12, y - .07 + j * .14, .75, .095, .115, .09, food[(i + j) % food.length]!)
          add(detail, x - .12 + i * .12, y - .07 + j * .14, .797, .06, .075, .005, 0xffecd2)
        }
      }
    }
    for (let i = 0; i < 6; i++) add(detail, .23 + i * .024, -.403, .28, .01, .007, .1, 0xa5adb2)
    board('freezer-front-badge', -.13, -d / 2 - .004, .6, .34, .008, .09, mats.blue)
  } else {
    const tiered = variant === 'fruit-tiered'
    const rows = tiered ? 3 : 2
    board('fruit-plinth', 0, 0, .09, .88, d - .05, .18, mats.woodDark)
    if (!tiered) for (let k = 0; k < 5; k++) board('fruit-island-slat', 0, -d / 2 + .014, .24 + k * .102, .885, .026, .092)
    if (!tiered) for (const x of [-.46, .46]) board('fruit-side', x, 0, .45, .035, d - .085, .7)
    for (let row = 0; row < rows; row++) {
      const y = tiered ? -.21 + row * .21 : -.215 + row * .43
      const z = tiered ? .35 + row * .43 : .78
      const trayDepth = tiered ? .205 : .41
      if (tiered) for (const x of [-.44, .44]) {
        const back = d / 2 - .025
        board('fruit-tier-bracket', x, (y + back) / 2, z - .03, .025, back - y + .04, .035, mats.darkSteel)
      }
      for (const x of [-.235, .235]) {
        board('fruit-bin-floor', x, y, z, .45, trayDepth, .035)
        for (const edge of [-1, 1]) {
          board('fruit-bin-side', x + edge * .22, y, z + .055, .016, trayDepth, .11, mats.woodDark)
          board('fruit-bin-lip', x, y + edge * (trayDepth / 2 - .01), z + .055, .42, .02, .11)
        }
        const kind = (row * 2 + (x > 0 ? 1 : 0)) % 4
        const color = [0xc64732, 0xa5c94e, 0xf0a13a, 0xeac64e][kind]!
        for (let i = 0; i < 4; i++) for (let j = 0; j < (tiered ? 2 : 4); j++) {
          const px = x - .15 + i * .1, py = y - (tiered ? .045 : .145) + j * .095
          if (kind === 3) add(bananas, px, py, z + .09 + ((i + j) % 2) * .018, .13, .2, .2, color, -.45)
          else {
            add(round, px, py, z + .09 + ((i + j) % 2) * .018, .092, .087, .09, color)
            add(detail, px, py, z + .14 + ((i + j) % 2) * .018, .008, .008, .015, 0x5c7138)
          }
        }
        add(detail, x, y - trayDepth / 2 - .002, z + .05, .11, .006, .044, 0x343d39)
      }
    }
    for (const x of [-.46, .46]) board('fruit-end-post', x, d / 2 - .025, h / 2, .035, .035, h, mats.woodDark)
    if (tiered) board('fruit-header', 0, d / 2 - .025, h - .055, .885, .035, .11, mats.woodDark)
    else {
      board('fruit-centre-divider', 0, 0, .915, .012, d - .03, .27, mats.glass)
      for (const x of [-.46, .46]) board('fruit-front-post', x, -d / 2 + .025, h / 2, .035, .035, h, mats.woodDark)
    }
  }
  stockBatch(g, mats.shelfGoods, 'stock-packages', boxes)
  stockBatch(g, mats.shelfGoods, 'stock-produce', round, stockSphere())
  stockBatch(g, mats.shelfGoods, 'stock-jars', jars, stockCylinder())
  stockBatch(g, mats.shelfGoods, 'stock-bananas', bananas, stockBanana())
  stockBatch(g, mats.shelfGoods, 'stock-garments', shirts, shirtGeometry())
  stockBatch(g, mats.shelfGoods, 'stock-details', detail)
  return true
}
