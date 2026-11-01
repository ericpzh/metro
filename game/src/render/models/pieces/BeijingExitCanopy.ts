import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { slab, plate, ownedMaterial, type ModuleContext } from '../PieceBuilder.ts'
import { setModelDetail, panelModelDetail, beamModelDetail, surfaceModelDetail, omitModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_REACH, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'

function inSidePlane(geometry:THREE.BufferGeometry,x:number,depth:number):THREE.BufferGeometry {
  return geometry.applyMatrix4(new THREE.Matrix4().set(0,0,1,x-depth/2,1,0,0,0,0,1,0,0,0,0,0,1))
}
/** Metal cut-out and inset glass share a diamond boundary, without coincident caps. */
export function beijingDiamondPanel(group:THREE.Group,metal:THREE.Material,glass:THREE.Material,x:number,lo:number,hi:number):void {
  const bottom=.08,top=EXIT_H-.13,mid=(lo+hi)/2,cz=(bottom+top)/2
  const panel=new THREE.Shape();panel.moveTo(lo,bottom);panel.lineTo(hi,bottom);panel.lineTo(hi,top);panel.lineTo(lo,top);panel.closePath()
  const hole=new THREE.Path();hole.moveTo(mid,bottom+.13);hole.lineTo(lo+.10,cz);hole.lineTo(mid,top-.13);hole.lineTo(hi-.10,cz);hole.closePath();panel.holes.push(hole)
  const shell=new THREE.Mesh(inSidePlane(new THREE.ExtrudeGeometry(panel,{depth:.055,bevelEnabled:true,bevelSegments:1,steps:1,bevelThickness:.008,bevelSize:.012}),x,.055),metal)
  shell.name='beijing-diamond-metal-panel';group.add(shell)
  setModelDetail(shell,inSidePlane(new THREE.ShapeGeometry(panel),x,0))
  const inset=.025,diamond=new THREE.Shape()
  diamond.moveTo(mid,bottom+.13+inset);diamond.lineTo(hi-.10-inset,cz);diamond.lineTo(mid,top-.13-inset);diamond.lineTo(lo+.10+inset,cz);diamond.closePath()
  const pane=new THREE.Mesh(inSidePlane(new THREE.ExtrudeGeometry(diamond,{depth:.018,bevelEnabled:false}),x,.018),glass)
  pane.name='beijing-diamond-glass';group.add(pane)
  setModelDetail(pane,inSidePlane(new THREE.ShapeGeometry(diamond),x,0))
}

/** Beijing's stainless entrance; upper and lower signs share the exact same artwork. */
export function buildBeijingCanopy(g:THREE.Group,ctx:ModuleContext,cx:number,width:number,header:THREE.MeshBasicMaterial):void {
  const metal=ownedMaterial(ctx,new THREE.MeshStandardMaterial({color:'#929a9e',roughness:.48,metalness:.42,side:THREE.DoubleSide}))
  const half=width/2,y0=-EXIT_REACH,y1=EXIT_BACK,side=half-.13
  const roof=new THREE.Mesh(new RoundedBoxGeometry(width,y1-y0,.28,3,.035),metal)
  roof.position.set(cx,(y0+y1)/2,EXIT_H+.12);roof.name='beijing-stainless-canopy';g.add(roof)
  setModelDetail(roof,new THREE.BoxGeometry(width,y1-y0,.28))
  panelModelDetail(slab(g,ctx.mats.white,cx,(y0+y1)/2,EXIT_H-.035,width-.14,y1-y0-.12,.025),'z')
  const lo=EXIT_BACK_Y+.08,hi=1.73,span=(hi-lo)/4
  for(const sign of [-1,1]) {
    const x=cx+sign*side
    for(let i=0;i<4;i++)beijingDiamondPanel(g,metal,ctx.mats.glass,x,lo+i*span+.006,lo+(i+1)*span-.006)
    for(const y of [EXIT_BACK_Y,1.85]){
      const post=slab(g,metal,x,y,EXIT_H/2,.22,.20,EXIT_H)
      post.name=y>0?'beijing-front-column':'beijing-rear-column'
      if(y>0)beamModelDetail(post,'z');else panelModelDetail(post)
    }
  }
  const rear=new THREE.Group();rear.rotation.z=Math.PI/2;rear.position.set(cx,EXIT_BACK_Y,0);g.add(rear)
  beijingDiamondPanel(rear,metal,ctx.mats.glass,0,-half+.20,half-.20)
  // Signs are decorative above the roof; they do not enlarge the walk/collision footprint.
  const signZ=EXIT_H+.78,frontY=1.68
  for(const x of [cx-width*.28,cx+width*.28])surfaceModelDetail(slab(g,metal,x,frontY,EXIT_H+.38,.065,.09,.25),'y',1)
  const top=slab(g,ctx.mats.darkSteel,cx,frontY,signZ,width-.3,.10,.70)
  top.name='beijing-rooftop-front-board';panelModelDetail(top)
  plate(g,header,width-.38,.62,cx,frontY+.056,signZ,Math.PI).name='beijing-rooftop-front-sign'
  const sx=cx-half+.12,sy=.27
  for(const y of [sy-.95,sy+.95])surfaceModelDetail(slab(g,metal,sx,y,EXIT_H+.38,.09,.065,.25),'x',1)
  const sideBoard=slab(g,ctx.mats.darkSteel,sx,sy,signZ,.10,2.70,.70)
  sideBoard.name='beijing-rooftop-side-board';panelModelDetail(sideBoard,'x')
  plate(g,header,2.62,.62,sx-.056,sy,signZ,-Math.PI/2).name='beijing-rooftop-side-sign'
  for(const x of [cx-width*.24,cx+width*.24])for(const y of [1.6,-1,-3.8]){
    const lamp=slab(g,ctx.mats.glow,x,y,EXIT_H-.06,.22,.50,.025)
    lamp.name='beijing-soffit-light';omitModelDetail(lamp)
  }
}
