import * as THREE from 'three'
import { slab, type ModelMaterials } from '../PieceBuilder.ts'
import { panelModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { stockBatch, stockCylinder, stockSphere, type StockPart } from './ShopStock.ts'

/** Two authored layouts on one continuous carcass; coordinates start at the anchor bay. */
export function buildWideBackbar(g: THREE.Group, mats: ModelMaterials, width: number): void {
  const centre = (width - 1) / 2, right = width - .5
  const cylinders: StockPart[] = [], boxes: StockPart[] = [], spheres: StockPart[] = []
  const add = (list: StockPart[], x: number, y: number, z: number, w: number, d: number, h: number, color: number) => list.push({x,y,z,w,d,h,color})
  const part = (name: string, mat: THREE.Material, x: number, y: number, z: number, w: number, d: number, h: number, axis?: 'x'|'y'|'z') => {
    const mesh = slab(g, mat, x,y,z,w,d,h); mesh.name = name
    if (axis) panelModelDetail(mesh, axis)
    return mesh
  }
  part('backbar-plinth', mats.darkSteel, centre,.015,.04,width-.1,.51,.08)
  part('backbar-cabinet', mats.white, centre,.015,.475,width-.06,.53,.79)
  part('backbar-worktop', mats.woodLight, centre,0,.9,width-.04,.6,.06,'z')
  // Wide drawers on the medium cabinet; a refrigerated centre on the long one.
  const doors = width === 2 ? 3 : 6, doorW = (width - .12) / doors
  for (let i=0;i<doors;i++) {
    const x = -.44 + doorW * (i+.5)
    const cold = width === 4 && (i===2 || i===3)
    part(cold ? 'backbar-fridge-door' : 'backbar-lower-door', cold ? mats.steel : mats.white, x,-.2625,.475,doorW-.015,.025,.71,'y')
    add(boxes,x,-.2825,.75,.14,.015,.012,0x626d72)
    if (width===2 && i===0) for (const z of [.32,.55]) add(boxes,x,-.277,z,doorW-.035,.006,.009,0x9da5a4)
  }
  for (const x of [-.455,right-.045]) part('backbar-side',mats.darkSteel,x,.15,1.52,.035,.3,1.18,'x')
  part('backbar-back',mats.darkSteel,centre,.2875,1.52,width-.125,.025,1.18,'y')
  part('backbar-cap',mats.darkSteel,centre,.15,2.13,width-.055,.3,.04,'z')

  const jar = (x:number,z:number,color:number) => {
    add(cylinders,x,.14,z+.09,.09,.09,.16,color)
    add(cylinders,x,.14,z+.177,.095,.095,.014,0xb7a17a)
    add(boxes,x,.092,z+.09,.06,.005,.075,0xf1e8d4)
  }
  const bottle = (x:number,z:number,color:number) => {
    add(cylinders,x,.14,z+.09,.07,.07,.16,color)
    add(cylinders,x,.14,z+.19,.025,.025,.04,0xa88a59)
    add(cylinders,x,.14,z+.215,.03,.03,.01,0x343f3a)
    add(boxes,x,.102,z+.09,.045,.004,.08,0xf0e4ca)
  }
  const dishes = (x:number,z:number) => {
    for(let i=0;i<6;i++) add(cylinders,x,.14,z+.012+i*.014,.18,.18,.012,0xece9df)
    for(const dx of [-.12,.12]) {
      add(cylinders,x+dx,.12,z+.13,.075,.075,.08,0xece9df)
      add(cylinders,x+dx,.12,z+.172,.057,.057,.004,0x655044)
    }
  }
  const deck = (x:number,w:number,z:number) => part('backbar-stock-deck',mats.woodLight,x,.14375,z,w,.2625,.025,'z')
  const divider = (x:number,bottom:number,top:number) => part('backbar-cubby-divider',mats.darkSteel,x,.14375,(bottom+top)/2,.025,.2625,top-bottom,'x')
  if (width===2) {
    // Narrow tea pantry at left, wide dish shelf above an open coffee prep bay.
    divider(.1,.93,2.11)
    for(const z of [1.18,1.48,1.78]) {
      deck(-.175,.525,z)
      for(const x of [-.31,-.14,.0]) jar(x,z+.0125,z===1.48?0x819667:0x967551)
    }
    for(const z of [1.53,1.87]) {
      deck(.775,1.325,z)
      dishes(.39,z+.0125)
      for(const x of [.79,.96,1.13,1.3]) bottle(x,z+.0125,0x54796b)
    }
  } else {
    // Long bar: low dish niche, broad central serving shelves, tall syrup pantry.
    divider(.45,.93,2.11); divider(2.45,.93,2.11)
    for(const z of [1.26,1.62,1.9]) {
      deck(.0,.875,z); dishes(-.22,z+.0125); dishes(.22,z+.0125)
    }
    for(const z of [1.56,1.9]) {
      deck(1.45,1.975,z)
      if(z===1.56) for(const x of [.72,1.02,1.32]) dishes(x,z+.0125)
      else for(const x of [.66,.86,1.06,1.26,1.46,1.66,1.86,2.06,2.26]) jar(x,z+.0125,0x927052)
      if(z===1.56) for(const x of [1.83,2.08,2.3]) add(boxes,x,.14,z+.11,.14,.13,.19,0xd5bd87)
    }
    for(const z of [1.2,1.5,1.8]) {
      deck(2.95,.975,z)
      for(const [i,x] of [2.58,2.77,2.96,3.15,3.34].entries()) bottle(x,z+.0125,[0x607b54,0x9c603e,0xb89a59][i%3]!)
    }
  }
  // Different workstations, with clear uninterrupted serving space between them.
  const kettleX = width===2 ? .38 : .8
  part('backbar-kettle-base',mats.steel,kettleX,.02,.94,.18,.18,.02,'z')
  add(spheres,kettleX,.02,1.03,.16,.16,.18,0xe9e7dd)
  add(cylinders,kettleX,.02,1.125,.105,.105,.014,0x3d4848)
  add(boxes,kettleX-.09,.02,1.04,.06,.035,.035,0xe9e7dd)
  const machineX = width===2 ? .92 : 1.5
  part('backbar-prep-machine',mats.darkSteel,machineX,.12,1.09,width===2?.25:.48,.19,.32)
  part('backbar-prep-tray',mats.steel,machineX,-.02,.95,width===2?.25:.48,.09,.04,'z')
  add(boxes,machineX,.021,1.17,.13,.008,.06,0x427d98)
  if(width===4) {
    part('backbar-sink-rim',mats.steel,2.92,-.04,.942,.58,.36,.024,'z')
    part('backbar-sink-well',mats.darkSteel,2.92,-.04,.956,.49,.27,.004,'z')
    const tap = part('backbar-tap',mats.steel,2.92,.18,1.061,.018,.018,.262)
    omitModelDetail(tap)
    add(boxes,2.92,.12,1.201,.018,.13,.018,0xb8bfc1)
    for(const x of [2.12,2.27]) jar(x,.93,0xbca578)
  } else {
    add(boxes,1.27,.08,1.015,.17,.16,.17,0xe5d5b4)
    for(let i=0;i<5;i++) add(boxes,1.27,.08,1.105+i*.009,.15,.14,.006,0xf2ece0)
  }
  stockBatch(g,mats.shelfGoods,'stock-jars',cylinders,stockCylinder())
  stockBatch(g,mats.shelfGoods,'stock-details',boxes)
  stockBatch(g,mats.shelfGoods,'stock-kettle',spheres,stockSphere())
}
