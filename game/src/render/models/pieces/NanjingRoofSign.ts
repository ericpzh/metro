import * as THREE from 'three'
import contours from '../../../assets/branding/nanjing-contours.json' with { type:'json' }
import { drawNanjingLogo } from '../../nanjingBranding.ts'
import { slab, plate, ownedMaterial, canvasTexture, type ModuleContext } from '../PieceBuilder.ts'
import { setModelDetail } from '../../modelDetail.ts'

/** Raised blossom and short 地铁/Metro stem above the entrance (P5–7). */
export function buildNanjingRoofSign(root:THREE.Group,ctx:ModuleContext,x:number,y:number,z:number):void {
  const silver=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#ced3d0',metalness:.6,roughness:.38}))
  const stem=slab(root,silver,x,y,z+.36,.18,.22,.72);stem.name='nanjing-rooftop-sign-stem';setModelDetail(stem,stem.geometry.clone())
  const shape=(coarse:boolean)=>{
    const s=new THREE.Shape(),path=contours.paths[0],step=coarse?Math.max(1,Math.floor(path.length/24)):1
    path.filter((_,i)=>i%step===0).forEach(([u,v],i)=>i?s.lineTo((u-.5)*.76,(.5-v)*.74):s.moveTo((u-.5)*.76,(.5-v)*.74));s.closePath();return s
  }
  const sign=new THREE.Mesh(new THREE.ExtrudeGeometry(shape(false),{depth:.10,bevelEnabled:true,bevelThickness:.009,bevelSize:.009,bevelSegments:3}),silver)
  sign.rotation.set(Math.PI/2,Math.PI/2,0);sign.position.set(x-.05,y,z+1.08);sign.name='nanjing-rooftop-blossom';root.add(sign)
  setModelDetail(sign,new THREE.ExtrudeGeometry(shape(true),{depth:.10,bevelEnabled:false}))
  if(typeof document!=='undefined'){
    const emblem=ownedMaterial(ctx,new THREE.MeshBasicMaterial({map:canvasTexture(512,512,g=>drawNanjingLogo(g,256,256,490)),transparent:true,alphaTest:.01}))
    const words=ownedMaterial(ctx,new THREE.MeshBasicMaterial({map:canvasTexture(192,768,g=>{
      g.fillStyle='#14213f';g.textAlign='center';g.textBaseline='middle';g.font='152px "Microsoft YaHei",sans-serif';g.fillText('地',96,130);g.fillText('铁',96,316)
      g.save();g.translate(96,550);g.rotate(Math.PI/2);g.font='66px Arial,sans-serif';g.fillText('Metro',0,0,340);g.restore()
    }),transparent:true}))
    for(const side of [-1,1]){
      plate(root,emblem,.76,.74,x+side*.063,y,z+1.08,side>0?Math.PI/2:-Math.PI/2).name='nanjing-rooftop-logo-face'
      plate(root,words,.17,.67,x+side*.091,y,z+.36,side>0?Math.PI/2:-Math.PI/2).name='nanjing-rooftop-metro-label'
    }
  }
}
