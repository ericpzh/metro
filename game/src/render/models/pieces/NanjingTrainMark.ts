import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { carSideSkin } from './CarShellProfile.ts'
import { STOCK, doorCentres, doorWidthAt, type StockClass } from '../../../sim/stock.ts'

/** Retained side decals at both cab ends; only the Nanjing texture paints them. */
export function buildNanjingTrainMarks(root:THREE.Group,mats:ModelMaterials,stock:StockClass,cars:number):void {
  if(stock==='D')return // Its curved cab side owns the fitted emblem.
  const s=STOCK[stock],half=s.length*cars/2,doors=doorCentres({stock,cars})
  for(const end of [-1,1]){
    const nose=end*half,near=doors.map(x=>({x,d:end*(nose-x)})).sort((a,b)=>a.d-b.d)
    // Separate crew door at 1.015 m behind the nose (C has a side cab window).
    const edge=near[0].d-doorWidthAt({stock,cars},near[0].x)/2
    const distance=((stock==='C'?1.84:1.42)+edge)/2
    const width=stock==='C'?.25:.38,height=stock==='C'?.32:.43,x=nose-end*distance,z=2.08
    for(const side of [-1,1]){
      const geometry=(low:boolean)=>{
        const geo=carSideSkin(s.width,x-width/2,x+width/2,z-height/2,z+height/2,side,low,.008),p=geo.getAttribute('position'),uv=[]
        for(let i=0;i<p.count;i++)uv.push(side<0?(p.getX(i)-x)/width+.5:.5-(p.getX(i)-x)/width,(p.getZ(i)-z)/height+.5)
        geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return geo
      }
      const mark=new THREE.Mesh(geometry(false),mats.nanjingTrainMark);mark.name=stock.toLowerCase()+'-nanjing-side-mark';root.add(mark)
    }
  }
}
