import * as THREE from 'three'
import { slab, plate, canvasTexture, ownedMaterial, placeLocal, type ModuleContext } from '../PieceBuilder.ts'
import { drawMetroMark } from '../../cityBranding.ts'
import { bindArtwork, bindArtworkTexture } from '../../artwork.ts'
import { panelModelDetail, setModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { t, tForLanguage } from '../../../sim/i18n.ts'
import type { Module, StationData } from '../../../sim/types.ts'

type Guide = Extract<Module,{type:'guidepost'}>
type Labels = (data: StationData, mod: Guide) => {station:string;exit:string}

/** Shenzhen's grey pylon and open circular green crown, shared by virtual exits. */
export function buildShenzhenGuidepost(ctx: ModuleContext, mod: Guide, labelsFor: Labels): THREE.Group {
  const root=new THREE.Group()
  root.userData.guideCityStyle='shenzhen'
  const grey=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#8d9993',roughness:.75}))
  const panel=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#a2ada5',roughness:.8}))
  const green=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#008f56',roughness:.45,side:THREE.DoubleSide}))
  const edge=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#99cab0',roughness:.45}))
  const body=slab(root,grey,0,0,1.665,.27,.27,3.33)
  body.name='shenzhen-guide-grey-column';panelModelDetail(body)
  const name=slab(root,panel,0,-.012,1.69,.29,.29,1.08)
  name.name='shenzhen-guide-station-panel';omitModelDetail(name)
  const brand=slab(root,panel,0,0,2.9,.30,.30,.82)
  brand.name='shenzhen-guide-brand-panel';omitModelDetail(brand)
  const stem=slab(root,grey,0,0,3.36,.12,.12,.12)
  stem.name='shenzhen-guide-crown-stem';omitModelDetail(stem)
  for(const y of [-.03,.03]) {
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.28,.025,8,48),y<0?green:edge)
    ring.rotation.x=Math.PI/2;ring.position.set(0,y,3.69);ring.name='shenzhen-guide-green-ring'
    if(y<0)setModelDetail(ring,new THREE.RingGeometry(.255,.305,8));else omitModelDetail(ring)
    root.add(ring)
  }
  const labels=labelsFor(ctx.data,mod);root.userData.guideLabels=labels
  bindArtwork(root,data=>{root.userData.guideLabels=labelsFor(data,mod)})
  if(typeof document!=='undefined') {
    const logo=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,alphaTest:.5,map:canvasTexture(256,256,g=>drawMetroMark(g,128,128,218,'#009943','shenzhen'))}))
    for(const side of [-1,1]) {
      const face=plate(root,logo,.44,.44,0,side*.057,3.69,side<0?0:Math.PI)
      face.name='shenzhen-guide-crown-emblem'
    }
    const drawBrand=(g:CanvasRenderingContext2D)=>{
      g.fillStyle='#eee8d4';g.textAlign='center';g.textBaseline='middle';g.font='bold 50px "Microsoft YaHei",sans-serif'
      Array.from(tForLanguage('zh-CN','metro')).forEach((ch,i)=>g.fillText(ch,64,48+i*56,110))
      g.save();g.translate(64,235);g.rotate(Math.PI/2);g.font='bold 40px Arial,sans-serif';g.fillText(t('printed_metro').toUpperCase(),0,0,190);g.restore()
    }
    const brandInk=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map:canvasTexture(128,384,drawBrand)}))
    const drawNames=(g:CanvasRenderingContext2D,data:StationData)=>{
      const labels=labelsFor(data,mod)
      g.fillStyle='#eee8d4';g.textAlign='center';g.textBaseline='middle';g.font='96px Arial,sans-serif'
      g.fillText(labels.exit,64,80,116)
      const chars=Array.from(labels.station), step=Math.min(74,320/Math.max(1,chars.length))
      g.font=`${step*.85}px "Microsoft YaHei",sans-serif`
      chars.forEach((ch,i)=>g.fillText(ch,85,230+i*step,58))
      g.save();g.translate(29,350);g.rotate(Math.PI/2);g.font='22px Arial,sans-serif'
      g.fillText(data.nameEn?.trim()||t('printed_metro_station'),0,0,205);g.restore()
    }
    const nameMap=canvasTexture(128,640,g=>drawNames(g,ctx.data))
    const nameInk=ownedMaterial(ctx,new THREE.MeshBasicMaterial({transparent:true,map:nameMap}))
    bindArtworkTexture(root,nameMap,drawNames)
    // Front and side faces have their own upright lettering, like the reference column.
    for(const [x,y,yaw] of [[0,-.164,0],[.164,0,Math.PI/2],[0,.164,Math.PI],[-.164,0,-Math.PI/2]]) {
      plate(root,brandInk,.255,.78,x,y,2.9,yaw).name='shenzhen-guide-vertical-metro'
      plate(root,nameInk,.25,1.32,x,y,1.88,yaw).name='shenzhen-guide-exit-station'
    }
  }
  return placeLocal(root,mod)
}
