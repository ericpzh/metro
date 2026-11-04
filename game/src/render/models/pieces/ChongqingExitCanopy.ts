import * as THREE from 'three'
import { slab, ownedMaterial, type ModuleContext } from '../PieceBuilder.ts'
import { setModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_BACK, EXIT_REACH, EXIT_BACK_Y } from '../../../sim/exits.ts'

export function chongqingRoofHeight(y:number):number {
  const t=THREE.MathUtils.clamp((EXIT_BACK-y)/(EXIT_BACK+EXIT_REACH),0,1)
  return EXIT_H-1.95*t*t
}
function section(x:number,width:number,points:readonly (readonly [number,number])[]):THREE.BufferGeometry {
  const s=new THREE.Shape();points.forEach(([y,z],i)=>i?s.lineTo(y,z):s.moveTo(y,z));s.closePath()
  const geo=new THREE.ExtrudeGeometry(s,{depth:width,bevelEnabled:false,steps:1})
  geo.applyMatrix4(new THREE.Matrix4().set(0,0,1,x-width/2, 1,0,0,0, 0,1,0,0, 0,0,0,1));return geo
}

type Point=readonly [number,number]
/** Clip glazing to the actual inclined rear face of the front portal column. */
function behindJamb(points:readonly Point[]):Point[]{
  const result:Point[]=[],distance=([y,z]:Point)=>1.36+.70*z/(EXIT_H-.04)-y
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b)
    if(da>=0)result.push(a)
    if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}
  }
  return result
}

/** Silver rolled canopy, inclined portal legs, stone bases and glazed side bays (P6–8). */
export function buildChongqingCanopy(house:THREE.Group,ctx:ModuleContext,cx:number,width:number):void {
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#bbc3c5',metalness:.55,roughness:.45}))
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#354044',roughness:.65}))
  const stone=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#a5aaa6',roughness:.95}))
  const profile=(steps:number)=>Array.from({length:steps+1},(_,i)=>EXIT_BACK_Y+(EXIT_BACK-EXIT_BACK_Y)*i/steps)
  const lowHeight=(y:number)=>{const mid=(EXIT_BACK_Y+EXIT_BACK)/2,left=y<mid?EXIT_BACK_Y:mid,right=y<mid?mid:EXIT_BACK;return THREE.MathUtils.lerp(chongqingRoofHeight(left),chongqingRoofHeight(right),(y-left)/(right-left))}
  const skin=(x:number,w:number,steps:number)=>{
    const ys=profile(steps)
    const top=ys.map(y=>[y,chongqingRoofHeight(y)] as const)
    return section(x,w,[...top,...[...ys].reverse().map(y=>[y,chongqingRoofHeight(y)-.16] as const)])
  }
  const roof=new THREE.Mesh(skin(cx,width-.608,64),silver);roof.name='chongqing-silver-roof';house.add(roof);setModelDetail(roof,skin(cx,width-.608,2))
  for(const sign of [-1,1]){
    const x=cx+sign*(width/2-.15)
    const edge=new THREE.Mesh(skin(x,.30,64),silver);edge.name='chongqing-rolled-side-edge';house.add(edge);setModelDetail(edge,skin(x,.30,2))
    const jamb=new THREE.Mesh(section(x,.30,[[1.36,0],[1.66,0],[2.40,EXIT_H-.04],[2.06,EXIT_H-.04]]),silver)
    jamb.name='chongqing-inclined-front-jamb';house.add(jamb);setModelDetail(jamb,jamb.geometry.clone())
    // Glass and stone stop behind the inclined column's rear face.
    const back=(z:number)=>1.36+.70*z/(EXIT_H-.04)
    const plinth=new THREE.Mesh(section(x,.27,[[EXIT_BACK_Y,0],[back(0),0],[back(.35),.35],[EXIT_BACK_Y,.35]]),stone)
    plinth.name='chongqing-stone-plinth';house.add(plinth);setModelDetail(plinth,plinth.geometry.clone())
    const glazing=(steps:number)=>section(x,.025,behindJamb([...profile(steps).map(y=>[y,chongqingRoofHeight(y)-.16] as const),[EXIT_BACK,.35],[EXIT_BACK_Y,.35]]))
    const glass=new THREE.Mesh(glazing(64),ctx.mats.glass);glass.name='chongqing-side-glass';house.add(glass);setModelDetail(glass,glazing(2))
    for(let i=0;i<5;i++){
      const a=EXIT_BACK_Y+(1.40-EXIT_BACK_Y)*i/5,h=chongqingRoofHeight(a)-.16-.35
      const post=slab(house,dark,x,a,.35+h/2,.06,.06,h);post.name='chongqing-glass-mullion'
      const low=new THREE.BoxGeometry(.06,.06,lowHeight(a)-.16-.35).translate(0,0,(lowHeight(a)-.16-.35-h)/2)
      // Roof and plinth cover these ends; retain the four visible sides at Low.
      low.setIndex(Array.from(low.index!.array.slice(0,24)));low.clearGroups();setModelDetail(post,low)
    }
  }
  const rearHeight=chongqingRoofHeight(EXIT_BACK_Y)-.16-.35
  const rear=slab(house,ctx.mats.glass,cx,EXIT_BACK_Y,.35+rearHeight/2,width-.30,.025,rearHeight)
  rear.name='chongqing-rear-glass';setModelDetail(rear,rear.geometry.clone())
  const base=slab(house,stone,cx,EXIT_BACK_Y,.175,width-.30,.27,.35);base.name='chongqing-rear-plinth';setModelDetail(base,base.geometry.clone())
  for(const y of [1.5,-.5,-2.3]){
    const lamp=slab(house,ctx.mats.glow,cx,y,chongqingRoofHeight(y)-.17,.40,.10,.015);omitModelDetail(lamp)
  }
}
