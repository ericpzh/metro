import * as THREE from 'three'
import { plate, ownedMaterial, canvasTexture, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { drawChengduLogo } from '../../chengduBranding.ts'
import { bindArtwork, bindArtworkTexture } from '../../artwork.ts'
import { setModelDetail } from '../../modelDetail.ts'
import { triangleColumn, threeFaces } from './GuidepostGeometry.ts'
import { t } from '../../../sim/i18n.ts'
import type { Module, StationData } from '../../../sim/types.ts'

type Guide=Extract<Module,{type:'guidepost'}>
type Labels=(data:StationData,mod:Guide)=>{station:string;exit:string}

const SIDE=.30, HEIGHT=SIDE*Math.sqrt(3)/2
/** Equilateral (60°) Chengdu section, centred on the pillar axis. */
const CHENGDU_PLAN:ReadonlyArray<readonly [number,number]>=[[-SIDE/2,HEIGHT/3],[0,-2*HEIGHT/3],[SIDE/2,HEIGHT/3]]

/** Vertical names share a top edge; English reads down the right of the Chinese. */
export function drawChengduGuideLabels(c:CanvasRenderingContext2D,station:string,exit:string,english:string):void {
  c.fillStyle='#ffffff';c.textAlign='center';c.textBaseline='middle'
  c.font='100px Arial,sans-serif';c.fillText(exit,96,70,157)
  const title=station.endsWith('站')?station:station+'站',chars=Array.from(title),step=Math.min(62,345/chars.length)
  c.font=`${step*.88}px "Microsoft YaHei",sans-serif`;chars.forEach((ch,i)=>c.fillText(ch,70,210+i*step,65))
  c.save();c.translate(151,210-step*.44);c.rotate(Math.PI/2);c.textAlign='left';c.font='22px Arial,sans-serif';c.fillText(english,0,0,chars.length*step);c.restore()
}

/** Equal equilateral sections: the blue middle turns 30 degrees about the shaft axis. */
export function buildChengduGuidepost(ctx:ModuleContext,mod:Guide,labelsFor:Labels):THREE.Group {
  const root=new THREE.Group();root.userData.guideCityStyle='chengdu'
  const charcoal=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#282d30',roughness:.72}))
  const blue=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#00a0df',roughness:.48}))
  const foot=triangleColumn(charcoal,.07,1.14,CHENGDU_PLAN);foot.name='chengdu-guide-triangular-base';root.add(foot)
  const column=triangleColumn(charcoal,2.97,1,CHENGDU_PLAN);column.position.z=.07;column.name='chengdu-guide-charcoal-blade';root.add(column)
  const crown=triangleColumn(charcoal,.48,1,CHENGDU_PLAN);crown.position.z=3.52;crown.name='chengdu-guide-charcoal-crown';root.add(crown)
  setModelDetail(crown,crown.geometry.clone())
  const turn=Math.PI/6,cos=Math.cos(turn),sin=Math.sin(turn)
  const collarPlan=CHENGDU_PLAN.map(([x,y])=>[x*cos-y*sin,x*sin+y*cos] as const)
  const collar=triangleColumn(blue,.48,1,collarPlan);collar.position.z=3.04;collar.name='chengdu-guide-blue-logo-box';root.add(collar)
  // Rotation exposes portions of both caps; neither cap is hidden by the shaft.
  setModelDetail(collar,collar.geometry.clone())
  root.userData.guideLabels=labelsFor(ctx.data,mod)
  bindArtwork(root,data=>{root.userData.guideLabels=labelsFor(data,mod)})
  if(typeof document!=='undefined') {
    const logo=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map:canvasTexture(384,192,c=>drawChengduLogo(c,192,96,340,true,'#ffffff'))}))
    const metro=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map:canvasTexture(128,256,c=>{
      c.fillStyle='#ffffff';c.textAlign='center';c.textBaseline='middle';c.font='54px "Microsoft YaHei",sans-serif';c.fillText('地',64,53);c.fillText('铁',64,119);c.font='24px Arial,sans-serif';c.fillText('METRO',64,195,120)
    })}))
    const paint=(c:CanvasRenderingContext2D,data:StationData)=>{
      const labels=labelsFor(data,mod)
      drawChengduGuideLabels(c,labels.station,labels.exit,data.nameEn?.trim()||t('printed_metro_station'))
    }
    const map=canvasTexture(192,640,c=>paint(c,ctx.data)),ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map}))
    bindArtworkTexture(root,map,paint)
    threeFaces(root,1,metro,3.52,4,'chengdu-guide-metro-heading',CHENGDU_PLAN)
    threeFaces(root,1,ink,1.045,2.995,'chengdu-guide-live-labels',CHENGDU_PLAN)
    for(let i=0;i<3;i++) {
      const a=collarPlan[i],b=collarPlan[(i+1)%3],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),nx=dy/length,ny=-dx/length
      plate(root,logo,length*.94,Math.min(.24,length/2),(a[0]+b[0])/2+nx*.001,(a[1]+b[1])/2+ny*.001,3.28,Math.atan2(nx,-ny)).name='chengdu-guide-exit-lockup'
    }
  }
  return placeLocal(root,mod)
}
