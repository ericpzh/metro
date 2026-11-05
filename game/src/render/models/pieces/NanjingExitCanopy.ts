import { buildNanjingRoofSign } from './NanjingRoofSign.ts'
import { drawNanjingLogo } from '../../nanjingBranding.ts'
import { bindArtworkTexture } from '../../artwork.ts'
import type { Module, StationData } from '../../../sim/types.ts'
import * as THREE from 'three'
import { slab, ownedMaterial, canvasTexture, type ModuleContext } from '../PieceBuilder.ts'
import { setModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'

export function nanjingRoofHeight(y:number):number {
  return EXIT_H-2.15*THREE.MathUtils.clamp((EXIT_BACK-y)/(EXIT_BACK-EXIT_BACK_Y),0,1)**2
}

function section(x:number,width:number,points:readonly (readonly [number,number])[]):THREE.BufferGeometry {
  const s=new THREE.Shape();points.forEach(([y,z],i)=>i?s.lineTo(y,z):s.moveTo(y,z));s.closePath()
  const geo=new THREE.ExtrudeGeometry(s,{depth:width,bevelEnabled:false,steps:1})
  geo.applyMatrix4(new THREE.Matrix4().set(0,0,1,x-width/2, 1,0,0,0, 0,1,0,0, 0,0,0,1));return geo
}

type Point=readonly [number,number]
/** Clip glazing to the actual inclined rear face of the front portal column. */
function behindJamb(points:readonly Point[]):Point[]{
  const result:Point[]=[],distance=([y,z]:Point)=>0.55+.55*z/(EXIT_H-.04)-y
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b)
    if(da>=0)result.push(a)
    if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}
  }
  return result
}

/** P5–7: silver sloping roof, broad white inclined portals and three sealed glass sides. */
export function buildNanjingCanopy(house:THREE.Group,ctx:ModuleContext,cx:number,width:number,mod:Extract<Module,{type:'exit'}>):void {
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#b8bfc0',metalness:.55,roughness:.45}))
  const white=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#e4e6e1',metalness:.3,roughness:.52}))
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#354044',roughness:.65}))
  const stone=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#a5aaa6',roughness:.95}))
  const profile=(steps:number)=>[...Array.from({length:steps+1},(_,i)=>EXIT_BACK_Y+(EXIT_BACK-EXIT_BACK_Y)*i/steps),EXIT_BACK+.55]
  const lowHeight=(y:number)=>{const mid=(EXIT_BACK_Y+EXIT_BACK)/2,left=y<mid?EXIT_BACK_Y:mid,right=y<mid?mid:EXIT_BACK;return THREE.MathUtils.lerp(nanjingRoofHeight(left),nanjingRoofHeight(right),(y-left)/(right-left))}
  const skin=(x:number,w:number,steps:number)=>{
    const ys=profile(steps)
    const top=ys.map(y=>[y,nanjingRoofHeight(y)] as const)
    return section(x,w,[...top,...[...ys].reverse().map(y=>[y,nanjingRoofHeight(y)-.16] as const)])
  }
  const roof=new THREE.Mesh(skin(cx,width-.808,64),silver);roof.name='nanjing-sloped-silver-roof';house.add(roof);setModelDetail(roof,skin(cx,width-.808,2))
  for(const sign of [-1,1]){
    const x=cx+sign*(width/2-.20)
    const edge=new THREE.Mesh(skin(x,.30,64),silver);edge.name='nanjing-folded-side-edge';house.add(edge);setModelDetail(edge,skin(x,.30,2))
    const jamb=new THREE.Mesh(section(x,.40,[[.55,0],[1.75,0],[2.30,EXIT_H-.04],[1.10,EXIT_H-.04]]),white)
    jamb.name='nanjing-inclined-front-jamb';house.add(jamb);setModelDetail(jamb,jamb.geometry.clone())
    if(typeof document!=='undefined'){
      const paint=(g:CanvasRenderingContext2D,data:StationData)=>{
        drawNanjingLogo(g,192,180,210);g.fillStyle='#14213f';g.textAlign='center';g.textBaseline='middle'
        g.font='42px "Microsoft YaHei",sans-serif';g.fillText(data.name,192,440,356)
        g.font='20px Arial,sans-serif';g.fillText((data.nameEn||'').toUpperCase(),192,492,356)
        const next=data.modules.find(m=>m.id===mod.id),exit=(next?.type==='exit'?next.cfg.name:mod.cfg.name)||'1'
        g.lineWidth=7;g.strokeStyle='#14213f';g.strokeRect(130,610,124,230);g.font='150px Arial,sans-serif';g.fillText(exit.replace(/(?:号口|出入口|出口|入口|口)$/u,''),192,735,115)
      }
      const map=canvasTexture(384,960,g=>paint(g,ctx.data)),ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map}))
      const z0=.35,z1=2.65,back=(z:number)=>.55+.55*z/(EXIT_H-.04),front=(z:number)=>back(z)+1.2,xx=x+sign*.202
      const p=[xx,back(z0)+.12,z0,xx,front(z0)-.12,z0,xx,front(z1)-.12,z1,xx,back(z1)+.12,z1]
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(sign>0?[0,0,1,0,1,1,0,1]:[1,0,0,0,0,1,1,1],2));geo.setIndex(sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]);geo.computeVertexNormals()
      const face=new THREE.Mesh(geo,ink);face.name='nanjing-portal-live-label';house.add(face);setModelDetail(face,geo.clone());bindArtworkTexture(house,map,paint)
    }

    // Glass and stone stop behind the inclined column's rear face.
    const back=(z:number)=>0.55+.55*z/(EXIT_H-.04)
    const plinth=new THREE.Mesh(section(x,.27,[[EXIT_BACK_Y,0],[back(0),0],[back(.35),.35],[EXIT_BACK_Y,.35]]),stone)
    plinth.name='nanjing-stone-plinth';house.add(plinth);setModelDetail(plinth,plinth.geometry.clone())
    const glazing=(steps:number)=>section(x,.025,behindJamb([...profile(steps).map(y=>[y,nanjingRoofHeight(y)-.16] as const),[EXIT_BACK,.35],[EXIT_BACK_Y,.35]]))
    const glass=new THREE.Mesh(glazing(64),ctx.mats.glass);glass.name='nanjing-side-glass';house.add(glass);setModelDetail(glass,glazing(2))
    for(let i=0;i<5;i++){
      const a=EXIT_BACK_Y+(1.40-EXIT_BACK_Y)*i/5,h=nanjingRoofHeight(a)-.16-.35
      const post=slab(house,dark,x,a,.35+h/2,.06,.06,h);post.name='nanjing-glass-mullion'
      if(i===2){omitModelDetail(post);continue}
      const low=new THREE.BoxGeometry(.06,.06,lowHeight(a)-.16-.35).translate(0,0,(lowHeight(a)-.16-.35-h)/2)
      // Roof and plinth cover these ends; retain the four visible sides at Low.
      low.setIndex(Array.from(low.index!.array.slice(0,24)));low.clearGroups();setModelDetail(post,low)
    }
  }
  buildNanjingRoofSign(house,ctx,cx-width/2+.2,1.15,nanjingRoofHeight(1.15))
  const rearHeight=nanjingRoofHeight(EXIT_BACK_Y)-.16-.35
  const rear=slab(house,ctx.mats.glass,cx,EXIT_BACK_Y,.35+rearHeight/2,width-.30,.025,rearHeight)
  rear.name='nanjing-rear-glass';setModelDetail(rear,rear.geometry.clone())
  const base=slab(house,stone,cx,EXIT_BACK_Y,.175,width-.30,.27,.35);base.name='nanjing-rear-plinth';setModelDetail(base,base.geometry.clone())
  for(const y of [1.5,-.5,-2.3]){
    const lamp=slab(house,ctx.mats.glow,cx,y,nanjingRoofHeight(y)-.17,.40,.10,.015);omitModelDetail(lamp)
  }
}
