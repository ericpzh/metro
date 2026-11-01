import * as THREE from 'three'
import { slab, plate, ownedMaterial, canvasTexture, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { drawMetroMark } from '../../cityBranding.ts'
import { panelModelDetail, setModelDetail } from '../../modelDetail.ts'
import type { Module } from '../../../sim/types.ts'

/** Shanghai's slim grey mast and four-sided white/red metro lantern. */
export function buildShanghaiGuidepost(ctx:ModuleContext,mod:Extract<Module,{type:'guidepost'}>):THREE.Group {
  const g=new THREE.Group();g.userData.guideCityStyle='shanghai'
  const grey=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#899296',roughness:.7}))
  const white=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#deded5',roughness:.8}))
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.065,.085,2.85,24),grey)
  pole.rotation.x=Math.PI/2;pole.position.z=1.425;pole.name='shanghai-guide-mast';g.add(pole)
  setModelDetail(pole,new THREE.CylinderGeometry(.065,.085,2.85,4,1,true))
  const housing=slab(g,white,0,0,3.36,.56,.56,1.0);housing.name='shanghai-guide-lantern';panelModelDetail(housing)
  panelModelDetail(slab(g,grey,0,0,.5,.18,.18,1))
  panelModelDetail(slab(g,grey,0,0,2.98,.565,.565,.23))
  for(const z of [2.85,3.87])panelModelDetail(slab(g,grey,0,0,z,.60,.60,.035))
  if(typeof document!=='undefined') {
    const ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.5,map:canvasTexture(256,320,c=>drawMetroMark(c,128,136,212,'#e60012','shanghai'))}))
    for(const [x,y,yaw] of [[0,-.282,0],[.282,0,Math.PI/2],[0,.282,Math.PI],[-.282,0,-Math.PI/2]]) {
      const face=plate(g,ink,.51,.68,x,y,3.48,yaw);face.name='shanghai-guide-red-emblem'
    }
  }
  return placeLocal(g,mod)
}
