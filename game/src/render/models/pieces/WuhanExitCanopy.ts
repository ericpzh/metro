import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { slab, ownedMaterial, type ModuleContext } from '../PieceBuilder.ts'
import { setModelDetail, panelModelDetail, beamModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'

/** P3–5/P7: flat silver fascia, charcoal portal and three completely glazed sides. */
export function buildWuhanCanopy(g:THREE.Group,ctx:ModuleContext,cx:number,width:number):void {
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#b8bdbd',metalness:.58,roughness:.42}))
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#41494b',metalness:.35,roughness:.6}))
  const stone=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#b0b1a7',roughness:.95}))
  const front=1.88,rear=EXIT_BACK_Y,depth=EXIT_BACK-rear,side=width/2-.14,soffit=EXIT_H-.08
  const rounded=(name:string,x:number,y:number,z:number,w:number,d:number,h:number,material:THREE.Material)=>{
    const m=new THREE.Mesh(new RoundedBoxGeometry(w,d,h,3,.012),material);m.position.set(x,y,z);m.name=name;g.add(m);setModelDetail(m,new THREE.BoxGeometry(w,d,h));return m
  }
  rounded('wuhan-flat-silver-roof',cx,(rear+EXIT_BACK)/2,EXIT_H+.10,width,depth,.36,silver)
  // Two folded fascia edges with a recessed dark reveal, segmented as the supplied roof.
  for(const z of [EXIT_H+.27,EXIT_H-.015])for(const y of [rear-.015,EXIT_BACK+.015]){
    const edge=slab(g,silver,cx,y,z,width,.06,.065);omitModelDetail(edge)
  }
  for(const s of [-1,1]){
    const x=cx+s*side,len=front-rear
    const base=slab(g,stone,x,(rear+front)/2,.225,.28,len,.45);base.name='wuhan-side-stone-base';setModelDetail(base,base.geometry.clone())
    const pane=slab(g,ctx.mats.glass,x,(rear+front)/2,(soffit+.45)/2,.025,len,soffit-.45);pane.name='wuhan-side-glass';panelModelDetail(pane,'x')
    for(const y of [rear,front]){
      const post=rounded('wuhan-portal-column',x,y,soffit/2,.28,.24,soffit,dark);beamModelDetail(post,'z')
      const foot=slab(g,stone,x,y,.225,.31,.27,.45);omitModelDetail(foot)
    }
    for(let i=1;i<6;i++){
      const y=rear+len*i/6
      const post=slab(g,dark,x,y,(soffit+.45)/2,.055,.055,soffit-.45);post.name='wuhan-side-mullion';omitModelDetail(post)
    }
    for(const z of [.49,1.48,2.39]){
      const bar=slab(g,dark,x,(rear+front)/2,z,.06,len,.055);bar.name='wuhan-glass-crossbar';omitModelDetail(bar)
    }
  }
  const glassW=width-.28
  const back=slab(g,ctx.mats.glass,cx,rear,(soffit+.45)/2,glassW,.025,soffit-.45);back.name='wuhan-rear-glass';panelModelDetail(back)
  const base=slab(g,stone,cx,rear,.225,glassW,.28,.45);base.name='wuhan-rear-stone-base';setModelDetail(base,base.geometry.clone())
  for(const z of [.49,1.48,2.39])omitModelDetail(slab(g,dark,cx,rear,z,glassW,.06,.055))
  for(let i=1;i<4;i++)omitModelDetail(slab(g,dark,cx-glassW/2+glassW*i/4,rear,(soffit+.45)/2,.055,.055,soffit-.45))
  // The rolled shutter is retracted: a real perforated strip below the plate.
  const w=width-.56,h=.20,shape=new THREE.Shape()
  shape.moveTo(-w/2,-h/2);shape.lineTo(w/2,-h/2);shape.lineTo(w/2,h/2);shape.lineTo(-w/2,h/2);shape.closePath()
  const n=Math.max(8,Math.floor(w/.15)),pitch=w/n
  for(let row=0;row<3;row++)for(let i=0;i<n;i++){
    const x=-w/2+(i+.2)*pitch,z=-.078+row*.058,hole=new THREE.Path()
    hole.moveTo(x,z);hole.lineTo(x,z+.023);hole.lineTo(x+pitch*.60,z+.023);hole.lineTo(x+pitch*.60,z);hole.closePath();shape.holes.push(hole)
  }
  const shutter=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:false}),silver)
  shutter.rotation.x=Math.PI/2;shutter.position.set(cx,front+.135,EXIT_H-.77);shutter.name='wuhan-perforated-shutter';g.add(shutter)
  setModelDetail(shutter,new THREE.PlaneGeometry(w,h))
  for(let i=1;i<Math.ceil(width/.65);i++)omitModelDetail(slab(g,dark,cx-width/2+i*width/Math.ceil(width/.65),EXIT_BACK+.046,EXIT_H+.10,.009,.005,.30))
  for(const y of [-4.6,-2.6,-.6,1.2]){
    const lamp=slab(g,ctx.mats.glow,cx,y,soffit-.015,.13,.55,.025);lamp.name='wuhan-soffit-light';omitModelDetail(lamp)
  }
}
