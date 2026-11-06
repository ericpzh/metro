import * as THREE from 'three'
import { slab, type ModelMaterials } from '../PieceBuilder.ts'
import { panelModelDetail } from '../../modelDetail.ts'
import { stockBatch, type StockPart } from './ShopStock.ts'

/** Full-width wooden bookcase or white handbag cubbies, on a two-cell run. */
export function buildDisplayShelves(g: THREE.Group, mats: ModelMaterials, variant: 'books'|'bags'): void {
  const books = variant === 'books', columns = books ? 2 : 5, rows = books ? 6 : 5
  const material = books ? mats.wood : mats.white
  const board = (name:string,x:number,y:number,z:number,w:number,d:number,h:number,axis:'x'|'y'|'z') => {
    const mesh=slab(g,material,x,y,z,w,d,h);mesh.name=name;panelModelDetail(mesh,axis)
  }
  // Panels butt at their edges; no duplicate rear/side or divider/deck skins.
  board('display-back',.5,.1875,1.035,1.88,.025,1.97,'y')
  for(const x of [-.455,1.455]) board('display-side',x,0,1.025,.03,.4,2.05,'x')
  const pitch=1.88/columns, rise=2/rows
  for(let row=0;row<=rows;row++) board('display-deck',.5,-.0125,.035+row*rise,1.88,.375,.03,'z')
  for(let row=0;row<rows;row++) for(let col=1;col<columns;col++) {
    board('display-divider',-.44+col*pitch,-.0125,.035+row*rise+rise/2,.025,.375,rise-.03,'x')
  }
  const stock:StockPart[]=[], details:StockPart[]=[], handles:StockPart[]=[]
  const colors=[0x40566b,0xad7652,0x718878,0xc8b99c,0x9a5353,0xd9d1ba]
  for(let row=0;row<rows;row++) for(let col=0;col<columns;col++) {
    const left=-.44+col*pitch, floor=.05+row*rise
    if(books) {
      // Upright volumes with varied heights, plus a horizontal folio stack.
      for(let i=0;i<12;i++) {
        const x=left+.065+i*.058, h=.205+((i+row)%4)*.018, color=colors[(i+row+col)%colors.length]!
        stock.push({x,y:-.005,z:floor+h/2,w:.045,d:.23,h,color})
        for(const offset of [.04,h-.035]) details.push({x,y:-.123,z:floor+offset,w:.03,d:.006,h:.008,color:0xe6dac1})
      }
      for(let i=0;i<3;i++) stock.push({x:left+.82,y:0,z:floor+.012+i*.025,w:.16,d:.24,h:.022,color:colors[(row+i)%colors.length]!})
    } else {
      const x=left+pitch/2, color=colors[(row*3+col)%colors.length]!
      stock.push({x,y:0,z:floor+.115,w:.25,d:.2,h:.23,color})
      details.push({x,y:-.1,z:floor+.12,w:.2,d:.008,h:.08,color})
      details.push({x,y:-.108,z:floor+.12,w:.025,d:.009,h:.025,color:0xc5aa6a})
      handles.push({x,y:0,z:floor+.225,w:.105,d:.105,h:.105,color:0x665044})
    }
  }
  const bag = new THREE.Shape()
  bag.moveTo(-.5,-.5); bag.lineTo(.5,-.5); bag.lineTo(.42,.4); bag.lineTo(.3,.5); bag.lineTo(-.3,.5); bag.lineTo(-.42,.4); bag.closePath()
  const bagGeometry = () => new THREE.ExtrudeGeometry(bag,{depth:.8,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.025,bevelThickness:.025}).rotateX(Math.PI/2).translate(0,.4,0)
  stockBatch(g,mats.shelfGoods,books?'stock-books':'stock-bags',stock,books?new THREE.BoxGeometry(1,1,1):bagGeometry())
  stockBatch(g,mats.shelfGoods,'stock-details',details)
  stockBatch(g,mats.shelfGoods,'stock-bag-handles',handles,new THREE.TorusGeometry(.5,.065,5,12,Math.PI).rotateX(Math.PI/2))
}
