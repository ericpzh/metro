import * as THREE from 'three'
import { slab, plate, canvasTexture, ownedMaterial, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { drawChongqingEmblem } from '../../chongqingBranding.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import type { Module } from '../../../sim/types.ts'

/** P10: dark round shaft, silver open ring and curved green, two-sided CRT box. */
export function chongqingGuideCrown(ctx:ModuleContext):THREE.Group {
  const g=new THREE.Group()
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#303a43',roughness:.62}))
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#c7cece',metalness:.6,roughness:.4,side:THREE.DoubleSide}))
  const green=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#008547',roughness:.5}))
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.085,.105,3.28,32),dark)
  shaft.rotation.x=Math.PI/2;shaft.position.z=1.64;shaft.name='chongqing-guide-round-shaft';g.add(shaft)
  setModelDetail(shaft,new THREE.CylinderGeometry(.085,.105,3.28,4,1,true))
  const ringShape=new THREE.Shape();ringShape.absarc(0,0,.68,0,Math.PI*2,false)
  const hole=new THREE.Path();hole.absarc(0,0,.55,0,Math.PI*2,true);ringShape.holes.push(hole)
  const ring=new THREE.Mesh(new THREE.ExtrudeGeometry(ringShape,{depth:.10,bevelEnabled:false,curveSegments:96}),silver)
  ring.rotation.x=Math.PI/2;ring.position.set(0,.05,3.38);ring.name='chongqing-guide-silver-ring';g.add(ring)
  setModelDetail(ring,new THREE.RingGeometry(.55,.68,11))
  // The box bows toward each approach; its end returns close the housing.
  const bannerGeometry=(steps:number,closed:boolean)=>{
    const vertices:number[]=[],uvs:number[]=[]
    const quad=(a:number[],b:number[],c:number[],d:number[])=>{
      for(const [p,u,v] of [[a,0,0],[b,1,0],[c,1,1],[a,0,0],[c,1,1],[d,0,1]] as const){vertices.push(...p);uvs.push(u,v)}
    }
    for(const side of [-1,1])for(let i=0;i<steps;i++){
      const a=-.79+1.58*i/steps,b=-.79+1.58*(i+1)/steps,y=(x:number)=>side*(steps===1?.18:.11+.07*(1-(x/.79)**2))
      const p=[[a,y(a),3.02],[b,y(b),3.02],[b,y(b),3.74],[a,y(a),3.74]]
      if(side<0)quad(p[0],p[1],p[2],p[3]);else quad(p[1],p[0],p[3],p[2])
      if(closed&&side<0)for(const z of [3.02,3.74]){
        const cap=[[a,-Math.abs(y(a)),z],[b,-Math.abs(y(b)),z],[b,Math.abs(y(b)),z],[a,Math.abs(y(a)),z]]
        if(z===3.74)quad(cap[0],cap[1],cap[2],cap[3]);else quad(cap[3],cap[2],cap[1],cap[0])
      }
    }
    if(closed)for(const x of [-.79,.79]){
      const y=steps===1?.18:.11,cap=[[x,-y,3.02],[x,y,3.02],[x,y,3.74],[x,-y,3.74]]
      if(x>0)quad(cap[0],cap[1],cap[2],cap[3]);else quad(cap[3],cap[2],cap[1],cap[0])
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.computeVertexNormals();return geo
  }
  const box=new THREE.Mesh(bannerGeometry(32,true),green);box.name='chongqing-guide-green-box';g.add(box)
  setModelDetail(box,bannerGeometry(1,true))
  if(typeof document!=='undefined'){
    const logo=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.01,map:canvasTexture(768,256,c=>drawChongqingEmblem(c,55,28,658,200,'#ffffff'))}))
    for(const side of [-1,1])plate(g,logo,1.33,.48,0,side*.183,3.38,side<0?0:Math.PI).name='chongqing-guide-crt-mark'
  }
  const foot=slab(g,dark,0,0,.025,.25,.25,.05);omitModelDetail(foot)
  return g
}

export function buildChongqingGuidepost(ctx:ModuleContext,mod:Extract<Module,{type:'guidepost'}>):THREE.Group {
  const g=chongqingGuideCrown(ctx);g.userData.guideCityStyle='chongqing';return placeLocal(g,mod)
}
