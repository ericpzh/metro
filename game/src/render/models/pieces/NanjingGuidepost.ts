import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { ownedMaterial, canvasTexture, plate, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { bindArtwork, bindArtworkTexture } from '../../artwork.ts'
import { setModelDetail } from '../../modelDetail.ts'
import { drawNanjingLogo } from '../../nanjingBranding.ts'
import { drawNanjingRailIcon } from './NanjingExitHeader.ts'
import type { Module, StationData } from '../../../sim/types.ts'

type Guide=Extract<Module,{type:'guidepost'}>
type Labels=(data:StationData,mod:Guide)=>{station:string;exit:string}
/** P9/P10: blue crown, curved separator, white body and bilingual live labels. */
export function drawNanjingGuideFace(g:CanvasRenderingContext2D,data:StationData,station:string,exit:string):void {
  g.fillStyle='#f4f7f7';g.fillRect(0,0,384,1800)
  g.fillStyle='#142d65';g.beginPath();g.moveTo(0,0);g.lineTo(384,0);g.lineTo(384,356);g.quadraticCurveTo(192,432,0,356);g.closePath();g.fill()
  drawNanjingLogo(g,192,190,258)
  g.strokeStyle=data.lines[0]?.colour??'#a6093d';g.lineWidth=15;g.beginPath();g.moveTo(0,390);g.quadraticCurveTo(192,466,384,390);g.stroke()
  drawNanjingRailIcon(g,144,502,96,'#14213f')
  g.fillStyle='#14213f';g.textAlign='center';g.textBaseline='middle';g.font='64px "Microsoft YaHei",sans-serif';g.fillText('地铁',192,665,330)
  g.font='34px Arial,sans-serif';g.fillText('Metro',192,725,330)
  const lines=data.lines.slice(0,3),slot=110,left=(384-lines.length*slot)/2
  lines.forEach((l,i)=>{g.fillStyle=l.colour;g.fillRect(left+i*slot,784,54,74);g.fillStyle='#ffffff';g.font='48px Arial,sans-serif';g.fillText(l.id,left+i*slot+27,822,50);g.fillStyle='#14213f';g.font='24px "Microsoft YaHei",sans-serif';g.fillText('号线',left+i*slot+81,806,52);g.font='16px Arial,sans-serif';g.fillText('Line '+l.id,left+i*slot+81,840,53)})
  g.fillStyle='#14213f';g.font='55px "Microsoft YaHei",sans-serif';g.fillText(station.replace(/站$/u,'')+'站',192,938,352)
  g.font='27px Arial,sans-serif';g.fillText((data.nameEn?.trim()||'').replace(/\s+station$/i,'').toUpperCase(),192,1002,348)
  g.lineWidth=6;g.strokeStyle='#14213f';g.strokeRect(120,1060,144,150);g.font='115px Arial,"Microsoft YaHei",sans-serif';g.fillText(exit,192,1138,132)
  // A quiet information panel below the operational labels, as in the references.
  g.fillStyle='#e4eaed';g.fillRect(32,1290,320,420);g.strokeStyle='#a4b1b9';g.lineWidth=3
  for(let i=0;i<5;i++){g.beginPath();g.moveTo(44,1340+i*70);g.lineTo(340,1340+i*70);g.stroke()}
  g.fillStyle='#142d65';g.fillRect(32,1258,320,42);g.fillStyle='#ffffff';g.font='24px "Microsoft YaHei",sans-serif';g.fillText(station,192,1279,300)
}
export function buildNanjingGuidepost(ctx:ModuleContext,mod:Guide,labelsFor:Labels):THREE.Group {
  const root=new THREE.Group();root.userData.guideCityStyle='nanjing'
  const white=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#e5e9e7',metalness:.3,roughness:.5}))
  const body=new THREE.Mesh(new RoundedBoxGeometry(.76,.28,3.8,3,.018),white);body.position.z=1.9;body.name='nanjing-guide-white-pylon';root.add(body);setModelDetail(body,new THREE.BoxGeometry(.76,.28,3.8))
  root.userData.guideLabels=labelsFor(ctx.data,mod);bindArtwork(root,data=>{root.userData.guideLabels=labelsFor(data,mod)})
  if(typeof document!=='undefined'){
    const paint=(g:CanvasRenderingContext2D,data:StationData)=>{const labels=labelsFor(data,mod);drawNanjingGuideFace(g,data,labels.station,labels.exit)}
    const map=canvasTexture(384,1800,g=>paint(g,ctx.data)),ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({map}))
    bindArtworkTexture(root,map,paint)
    for(const side of [-1,1])plate(root,ink,.72,3.76,0,side*.141,1.90,side<0?0:Math.PI).name='nanjing-guide-live-face'
  }
  return placeLocal(root,mod)
}
