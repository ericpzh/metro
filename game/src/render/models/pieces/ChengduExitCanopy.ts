import * as THREE from 'three'
import { slab, ownedMaterial, type ModuleContext } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_REACH, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'

/** Green rolled edges follow the silver roof's descending rear profile (P3). */
export function chengduRoofHeight(y:number):number {
  const t=THREE.MathUtils.clamp((EXIT_BACK-y)/(EXIT_BACK+EXIT_REACH),0,1)
  return EXIT_H-2.28*t*t
}

/** One shared coarse profile keeps Low roof, trim, glazing and posts together. */
function lowRoofHeight(y:number):number {
  const middle=(EXIT_BACK-EXIT_REACH)/2,a=y<middle?-EXIT_REACH:middle,b=y<middle?middle:EXIT_BACK
  return THREE.MathUtils.lerp(chengduRoofHeight(a),chengduRoofHeight(b),(y-a)/(b-a))
}

const JAMB_TOP=EXIT_H-.08,JAMB_SLOPE=(1.90-1.51)/(JAMB_TOP-.30)
const JAMB_HALF_DEPTH=.21*Math.sqrt(1+JAMB_SLOPE*JAMB_SLOPE),JOINT_GAP=.004
function jambBack(z:number):number { return 1.51+JAMB_SLOPE*(z-.30)-JAMB_HALF_DEPTH }

type SectionPoint=readonly [number,number]
function extrudedSection(x:number,width:number,points:readonly SectionPoint[]):THREE.BufferGeometry {
  const shape=new THREE.Shape()
  points.forEach(([y,z],i)=>i?shape.lineTo(y,z):shape.moveTo(y,z));shape.closePath()
  const geo=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1})
  geo.applyMatrix4(new THREE.Matrix4().set(0,0,1,x-width/2,1,0,0,0,0,1,0,0,0,0,0,1));return geo
}

/** Clip to the same inclined rear face used by the actual front column. */
function behindJamb(points:readonly SectionPoint[]):SectionPoint[] {
  const result:SectionPoint[]=[],distance=([y,z]:SectionPoint)=>jambBack(z)-JOINT_GAP-y
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b)
    if(da>=0)result.push(a)
    if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}
  }
  return result
}

function skin(x:number,width:number,y0:number,y1:number,offset:number,depth:number,steps:number,bottom?:number):THREE.BufferGeometry {
  const points:SectionPoint[]=[]
  const middle=(EXIT_BACK-EXIT_REACH)/2
  const ys=steps===2?[y0,...(middle>y0&&middle<y1?[middle]:[]),y1]:Array.from({length:steps+1},(_,i)=>y0+(y1-y0)*i/steps)
  const height=steps===2?lowRoofHeight:chengduRoofHeight
  for(const y of ys)points.push([y,height(y)+offset])
  for(const y of [...ys].reverse())points.push([y,bottom??height(y)+offset-depth])
  return extrudedSection(x,width,bottom===undefined?points:behindJamb(points))
}

export function buildChengduCanopy(house:THREE.Group,ctx:ModuleContext,cx:number,width:number):void {
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#bcc1bf',metalness:.55,roughness:.48}))
  const green=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#84b59a',metalness:.22,roughness:.54}))
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#333b3c',roughness:.7}))
  const stone=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#989c98',roughness:.95}))
  const y0=-EXIT_REACH,y1=EXIT_BACK,side=width/2-.15
  const addSkin=(name:string,x:number,w:number,a:number,b:number,offset:number,depth:number,mat:THREE.Material,bottom?:number)=>{
    const mesh=new THREE.Mesh(skin(x,w,a,b,offset,depth,64,bottom),mat);mesh.name=name;house.add(mesh)
    setModelDetail(mesh,skin(x,w,a,b,offset,depth,2,bottom));return mesh
  }
  // Stop both silver skins inside the green edge's inner face, including end caps.
  const innerWidth=2*(side-.14)-.008
  addSkin('chengdu-silver-curved-roof',cx,innerWidth,y0,y1,.14,.15,silver)
  addSkin('chengdu-pale-soffit',cx,innerWidth-.10,y0+.04,y1-.04,-.025,.025,silver)
  for(const sign of [-1,1]) {
    const x=cx+sign*side
    addSkin('chengdu-green-rolled-edge',x,.28,y0,y1,.20,.26,green)
    addSkin('chengdu-dark-edge-recess',x+sign*.144,.006,y0+.04,y1-.07,.13,.085,dark)
    const fittedBand=(name:string,material:THREE.Material,w:number,lo:number,hi:number)=>{
      const mesh=new THREE.Mesh(extrudedSection(x,w,[[EXIT_BACK_Y,lo],[jambBack(lo)-JOINT_GAP,lo],[jambBack(hi)-JOINT_GAP,hi],[EXIT_BACK_Y,hi]]),material)
      mesh.name=name;house.add(mesh);setModelDetail(mesh,mesh.geometry.clone())
    }
    fittedBand('chengdu-stone-plinth',stone,.28,0,.50)
    fittedBand('chengdu-green-sill',green,.24,.504,.59)
    const n=5,start=EXIT_BACK_Y,end=1.64,span=(end-start)/n
    for(let i=0;i<n;i++) {
      const a=start+i*span,b=a+span
      addSkin('chengdu-side-glass',x,.035,a+.065,i===n-1?EXIT_BACK:b-.065,-.14,0,ctx.mats.glass,.61)
      const h=chengduRoofHeight(a)-.16-.59
      const mullion=slab(house,dark,x,a,.59+h/2,.095,.09,h);mullion.name='chengdu-glazing-mullion'
      const lowH=lowRoofHeight(a)-.16-.59
      setModelDetail(mullion,new THREE.BoxGeometry(.095,.09,lowH).translate(0,0,(lowH-h)/2))
    }
    // Horizontal end cuts seat the inclined leg on the floor, with its true rear
    // face shared by the fitted stone, sill and final glazing panel.
    const jamb=new THREE.Mesh(extrudedSection(x,.28,[[jambBack(0),0],[jambBack(0)+2*JAMB_HALF_DEPTH,0],[jambBack(JAMB_TOP)+2*JAMB_HALF_DEPTH,JAMB_TOP],[jambBack(JAMB_TOP),JAMB_TOP]]),silver)
    jamb.name='chengdu-slanted-front-jamb';house.add(jamb);setModelDetail(jamb,jamb.geometry.clone())
  }
  const z=.61,h=chengduRoofHeight(EXIT_BACK_Y)-.14-z
  const rear=slab(house,ctx.mats.glass,cx,EXIT_BACK_Y,z+h/2,width-.52,.035,h);rear.name='chengdu-rear-glass'
  setModelDetail(rear,new THREE.BoxGeometry(width-.52,.035,lowRoofHeight(EXIT_BACK_Y)-.14-z).translate(0,0,(lowRoofHeight(EXIT_BACK_Y)-.14-z-h)/2))
  for(const y of [1.7,-.4,-2.5])for(const x of [cx-width*.25,cx+width*.25]) {
    const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.018,24),ctx.mats.glow)
    lamp.rotation.x=Math.PI/2;lamp.position.set(x,y,chengduRoofHeight(y)-.07);lamp.name='chengdu-recessed-downlight';house.add(lamp);omitModelDetail(lamp)
  }
}
