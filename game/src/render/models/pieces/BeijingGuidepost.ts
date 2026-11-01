import * as THREE from 'three'
import { slab, plate, ownedMaterial, canvasTexture, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { drawMetroMark } from '../../cityBranding.ts'
import { beamModelDetail, setModelDetail } from '../../modelDetail.ts'
import { bindArtwork, bindArtworkTexture } from '../../artwork.ts'
import { t, tForLanguage } from '../../../sim/i18n.ts'
import type { Module, StationData } from '../../../sim/types.ts'
type Guide=Extract<Module,{type:'guidepost'}>
type Labels=(data:StationData,mod:Guide)=>{station:string;exit:string}

/** Blue Beijing station pylon with a cylindrical DC crown and live exit/line labels. */
export function buildBeijingGuidepost(ctx:ModuleContext,mod:Guide,labelsFor:Labels):THREE.Group {
  const g=new THREE.Group();g.userData.guideCityStyle='beijing'
  const blue=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#143a5c',roughness:.55,metalness:.2}))
  const base=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#603b3d',roughness:.8}))
  const body=slab(g,blue,0,0,1.72,.32,.34,3.44);body.name='beijing-guide-blue-column';beamModelDetail(body,'z')
  const foot=slab(g,base,0,0,.30,.325,.345,.60);foot.name='beijing-guide-burgundy-base';beamModelDetail(foot,'z')
  const drum=new THREE.Mesh(new THREE.CylinderGeometry(.275,.275,.25,32),blue)
  drum.position.set(0,0,3.69);drum.name='beijing-guide-drum';g.add(drum)
  setModelDetail(drum,new THREE.CylinderGeometry(.275,.275,.25,4))
  const labels=labelsFor(ctx.data,mod);g.userData.guideLabels=labels
  bindArtwork(g,data=>{g.userData.guideLabels=labelsFor(data,mod)})
  if(typeof document!=='undefined') {
    const crown=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.5,map:canvasTexture(256,256,c=>drawMetroMark(c,128,128,246,'#f5f2df','beijing'))}))
    for(const sign of [-1,1])plate(g,crown,.52,.52,0,sign*.128,3.69,sign<0?0:Math.PI).name='beijing-guide-station-emblem'
    const paint=(c:CanvasRenderingContext2D,data:StationData)=>{
      const labels=labelsFor(data,mod);c.fillStyle='#eeeede';c.textAlign='center';c.textBaseline='middle'
      const title=(labels.station.startsWith(tForLanguage('zh-CN','metro'))?'':tForLanguage('zh-CN','metro'))+labels.station+(labels.station.endsWith('站')?'':'站')
      const chars=Array.from(title),step=Math.min(46,305/Math.max(1,chars.length))
      c.font=`${step*.85}px "Microsoft YaHei",sans-serif`;chars.forEach((ch,i)=>c.fillText(ch,90,26+i*step,65))
      c.save();c.translate(29,170);c.rotate(Math.PI/2);c.font='22px Arial,sans-serif';c.fillText(data.nameEn?.trim()||t('printed_metro_station'),0,0,285);c.restore()
      c.font='58px Arial,sans-serif';c.fillText(labels.exit,64,365,112)
      data.lines.slice(0,2).forEach((line,i)=>{const y=422+i*65;c.fillStyle=line.colour;c.fillRect(4,y,120,59);c.fillStyle='#ffffff';c.font='43px Arial,sans-serif';c.fillText(line.id,34,y+29,54);c.font='15px "Microsoft YaHei",sans-serif';c.fillText(t('printed_line_suffix'),91,y+18,55);c.font='11px Arial,sans-serif';c.fillText(t('printed_line_value',line.id),88,y+40,55)})
      // Small route/information panel below the line badges, printed on the same retained face.
      c.fillStyle='#e3e7e5';c.fillRect(12,560,104,65);c.fillStyle='#143a5c';c.fillRect(12,560,104,10)
      c.strokeStyle='#619882';c.lineWidth=3;c.beginPath();c.moveTo(25,610);c.lineTo(45,590);c.lineTo(75,598);c.lineTo(102,580);c.stroke()
      c.fillStyle='#ffffff';for(const [x,y] of [[25,610],[45,590],[75,598],[102,580]]){c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill()}
    }
    const map=canvasTexture(128,640,c=>paint(c,ctx.data)),ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({map,transparent:true}))
    bindArtworkTexture(g,map,paint)
    for(const [x,y,yaw] of [[0,-.172,0],[.162,0,Math.PI/2],[0,.172,Math.PI],[-.162,0,-Math.PI/2]])plate(g,ink,.29,2.60,x,y,1.98,yaw).name='beijing-guide-live-labels'
  }
  return placeLocal(g,mod)
}
