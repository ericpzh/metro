import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { slab, plate, canvasTexture, ownedMaterial, type ModuleContext } from '../PieceBuilder.ts'
import { drawMetroMark } from '../../cityBranding.ts'
import { panelModelDetail, omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_REACH, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'

/** Shanghai grey entrance: flat overhanging roof, light soffit, stone base and glazed bays. */
export function buildShanghaiCanopy(g:THREE.Group,ctx:ModuleContext,cx:number,width:number):void {
  const metal=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#5c6268',roughness:.65}))
  const stone=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#92938b',roughness:1}))
  const half=width/2,side=half-.13,y0=-EXIT_REACH,y1=EXIT_BACK,depth=y1-y0
  const roof=new THREE.Mesh(new RoundedBoxGeometry(width,depth,.22,3,.055),metal)
  roof.position.set(cx,(y0+y1)/2,EXIT_H+.08);roof.name='shanghai-flat-canopy';g.add(roof)
  const low=new THREE.BoxGeometry(width,depth,.22);setModelDetail(roof,low)
  const soffit=slab(g,ctx.mats.white,cx,(y0+y1)/2,EXIT_H-.05,width-.15,depth-.12,.025)
  soffit.name='shanghai-pale-soffit';panelModelDetail(soffit)
  const start=EXIT_BACK_Y+.06,end=1.74,span=(1.85-EXIT_BACK_Y)/4
  for(const sign of [-1,1]) {
    const x=cx+sign*side
    const base=slab(g,stone,x,(start+end)/2,.45,.22,end-start,.9);base.name='shanghai-stone-plinth';panelModelDetail(base)
    for(let i=0;i<4;i++){
      const y=EXIT_BACK_Y+i*span,lo=i===0?0:.9
      const post=slab(g,metal,x,y,(lo+EXIT_H)/2,.12,.1,EXIT_H-lo);post.name='shanghai-mullion';panelModelDetail(post)
      const a=y+.055,b=i===3?.745:y+span-.055
      const pane=slab(g,ctx.mats.glass,x,(a+b)/2,(.91+EXIT_H-.08)/2,.035,b-a,EXIT_H-.08-.91)
      pane.name='shanghai-side-glass';panelModelDetail(pane)
    }
    const pier=slab(g,metal,x,(.75+end)/2,(.9+EXIT_H)/2,.22,end-.75,EXIT_H-.9)
    pier.name='shanghai-logo-pier';panelModelDetail(pier)
    const jamb=slab(g,metal,x,1.85,EXIT_H/2,.22,.22,EXIT_H);jamb.name='shanghai-front-jamb';panelModelDetail(jamb)
    if(typeof document!=='undefined') {
      const mat=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.5,map:canvasTexture(256,256,c=>{c.fillStyle='#efeee3';c.beginPath();c.arc(128,128,126,0,Math.PI*2);c.fill();drawMetroMark(c,128,128,214,'#e60012','shanghai')})}))
      plate(g,mat,.45,.45,x+sign*.115,1.16,2.68,sign*Math.PI/2).name='shanghai-entrance-side-logo'
    }
  }
  panelModelDetail(slab(g,ctx.mats.glass,cx,EXIT_BACK_Y,EXIT_H/2,width-.39,.035,EXIT_H-.1))
  for(const x of [cx-width*.24,cx+width*.24])for(const y of [1.7,-.6,-3]){
    const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.02,24),ctx.mats.glow)
    lamp.rotation.x=Math.PI/2;lamp.position.set(x,y,EXIT_H-.075);lamp.name='shanghai-downlight';g.add(lamp);omitModelDetail(lamp)
  }
}
