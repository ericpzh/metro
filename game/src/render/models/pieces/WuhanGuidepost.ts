import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { slab, plate, ownedMaterial, canvasTexture, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { bindArtwork, bindArtworkTexture } from '../../artwork.ts'
import { setModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { drawWuhanLogo } from '../../wuhanBranding.ts'
import type { Module, StationData } from '../../../sim/types.ts'

type Guide=Extract<Module,{type:'guidepost'}>
export type WuhanLabels=(data:StationData,mod:Guide)=>{station:string;exit:string}

/** P8: vertical bilingual station, large exit letter, and live line-colour band. */
export function drawWuhanGuideLabels(g:CanvasRenderingContext2D,station:string,exit:string,english:string,lines:readonly {id:string;colour:string}[]):void {
  g.fillStyle='#f2f2ed';g.textBaseline='middle';g.textAlign='center'
  const title=station.endsWith('站')?station:station+'站',chars=Array.from(title),step=Math.min(54,300/Math.max(1,chars.length))
  g.font=`${step*.88}px "Microsoft YaHei",sans-serif`;chars.forEach((ch,i)=>g.fillText(ch,118,54+i*step,67))
  g.save();g.translate(50,30);g.rotate(Math.PI/2);g.textAlign='left';g.font='20px Arial,sans-serif'
  g.fillText(english.trim().replace(/\s+station$/i,'').toUpperCase()+' STATION',0,0,300);g.restore()
  g.font='85px Arial,"Microsoft YaHei",sans-serif';g.fillText(exit,96,414,173)
  const badges=lines.slice(0,3),h=64/Math.max(1,badges.length)
  badges.forEach((line,i)=>{
    const y=491+i*h;g.fillStyle=line.colour;g.fillRect(0,y,192,h)
    g.fillStyle='#ffffff';g.font=`${Math.min(29,h*.7)}px "Microsoft YaHei",sans-serif`;g.fillText(line.id+'号线',96,y+h/2,180)
  })
}

/** Closed square shaft and four-sided logo cube; caps remain closed at Low. */
export function wuhanGuideColumn(ctx:ModuleContext,mod:Guide,labelsFor:WuhanLabels):THREE.Group {
  const root=new THREE.Group();root.userData.guideCityStyle='wuhan'
  const dark=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#41494c',metalness:.32,roughness:.6}))
  const trim=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#788387',metalness:.48,roughness:.45}))
  const rounded=(name:string,w:number,d:number,h:number,z:number,material:THREE.Material)=>{
    const m=new THREE.Mesh(new RoundedBoxGeometry(w,d,h,3,.009),material);m.position.z=z;m.name=name;root.add(m);setModelDetail(m,new THREE.BoxGeometry(w,d,h));return m
  }
  rounded('wuhan-guide-square-shaft',.33,.33,3.35,1.675,dark)
  rounded('wuhan-guide-logo-cube',.65,.65,.65,3.675,dark)
  omitModelDetail(slab(root,trim,0,0,.025,.39,.39,.05))
  root.userData.guideLabels=labelsFor(ctx.data,mod)
  bindArtwork(root,data=>{root.userData.guideLabels=labelsFor(data,mod)})
  if(typeof document!=='undefined'){
    const logo=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.01,map:canvasTexture(384,384,g=>drawWuhanLogo(g,192,192,306,'#ffffff'))}))
    const paint=(g:CanvasRenderingContext2D,data:StationData)=>{
      const labels=labelsFor(data,mod);drawWuhanGuideLabels(g,labels.station,labels.exit,data.nameEn||'',data.lines)
    }
    const map=canvasTexture(192,640,g=>paint(g,ctx.data)),ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map}))
    bindArtworkTexture(root,map,paint)
    for(const [x,y,yaw] of [[0,-1,0],[1,0,Math.PI/2],[0,1,Math.PI],[-1,0,-Math.PI/2]]){
      plate(root,logo,.56,.56,x*.326,y*.326,3.675,yaw).name='wuhan-guide-logo-face'
      plate(root,ink,.328,2.25,x*.166,y*.166,2.12,yaw).name='wuhan-guide-live-labels'
    }
  }
  return root
}
export function buildWuhanGuidepost(ctx:ModuleContext,mod:Guide,labelsFor:WuhanLabels):THREE.Group {
  return placeLocal(wuhanGuideColumn(ctx,mod,labelsFor),mod)
}
