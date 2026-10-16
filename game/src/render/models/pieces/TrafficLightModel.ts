import * as THREE from 'three'
import { PieceBuilder, slab, placeLocal } from '../PieceBuilder.ts'
import { batchStaticParts } from '../../batchStaticModule.ts'
import type { Module } from '../../../sim/types.ts'

/** Slim roadside pole and three vertical lenses, facing local -Y (§9.5). */
export class TrafficLightModel extends PieceBuilder {
  readonly kind='traffic-light'
  build(mod:Extract<Module,{type:'traffic-light'}>):THREE.Group {
    const g=new THREE.Group(),m=this.ctx.mats
    slab(g,m.darkSteel,0,0,.06,.32,.32,.12)
    slab(g,m.steel,0,0,1.45,.09,.09,2.9)
    slab(g,m.black,0,-.04,2.97,.42,.26,1.06)
    for(let i=0;i<3;i++) {
      const lens=new THREE.Mesh(new THREE.CircleGeometry(.125,12),i===2?m.ledGreen:m.darkSteel)
      lens.name=`traffic-lens-${i}`;lens.rotation.x=Math.PI/2;lens.position.set(0,-.181,3.3-i*.33);g.add(lens)
      slab(g,m.darkSteel,0,-.21,3.45-i*.33,.36,.3,.035)
    }
    batchStaticParts(g,new Set(g.children.filter(o=>o.name.startsWith('traffic-lens-'))))
    return placeLocal(g,mod)
  }
}
