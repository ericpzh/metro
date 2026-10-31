import * as THREE from 'three'
import { slab, plate, ownedMaterial, canvasTexture, type ModuleContext } from '../PieceBuilder.ts'
import { panelModelDetail, omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { EXIT_H, EXIT_REACH, EXIT_BACK, EXIT_BACK_Y } from '../../../sim/exits.ts'
import { tForLanguage, t } from '../../../sim/i18n.ts'

/** Shared roof/glazing profile: level at the street, curving down to the rear plinth. */
export function shenzhenRoofHeight(y: number): number {
  const t = THREE.MathUtils.clamp((EXIT_BACK-y)/(EXIT_BACK+EXIT_REACH),0,1)
  return EXIT_H-2.12*t*t
}

function curvedPanel(x: number, width: number, y0: number, y1: number, bottom: number | null, topOffset: number, segments: number, thickness = .16): THREE.BufferGeometry {
  const shape=new THREE.Shape()
  for(let i=0;i<=segments;i++) {
    const y=y0+(y1-y0)*i/segments,z=shenzhenRoofHeight(y)+topOffset
    if(i===0)shape.moveTo(y,z);else shape.lineTo(y,z)
  }
  for(let i=segments;i>=0;i--) {
    const y=y0+(y1-y0)*i/segments
    shape.lineTo(y,bottom ?? shenzhenRoofHeight(y)+topOffset-thickness)
  }
  shape.closePath()
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1})
  geometry.applyMatrix4(new THREE.Matrix4().set(0,0,1,x-width/2,1,0,0,0,0,1,0,0,0,0,0,1))
  return geometry
}

/** Shenzhen head-house within the shared exit footprint and walking opening. */
export function buildShenzhenCanopy(house: THREE.Group, ctx: ModuleContext, centre: number, width: number): void {
  const frame = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: '#343c40', roughness: .65 }))
  const lining = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: '#d2d3c9', roughness: .85 }))
  const stone = ownedMaterial(ctx, new THREE.MeshStandardMaterial({ color: '#8b8e90', roughness: .95 }))
  const half = width / 2, side = half - .13
  const y0 = -EXIT_REACH, y1 = EXIT_BACK
  const roof = new THREE.Mesh(curvedPanel(centre,width,y0,y1,null,.14,32),frame)
  roof.name = 'shenzhen-curved-canopy';house.add(roof)
  setModelDetail(roof,curvedPanel(centre,width,y0,y1,null,.14,4))
  // Pale underside follows the same curve; a thin skin avoids coplanar dark faces.
  const soffit = new THREE.Mesh(curvedPanel(centre,width-.12,y0+.06,y1-.06,null,-.025,32,.025),lining)
  soffit.name = 'shenzhen-canopy-soffit';house.add(soffit)
  setModelDetail(soffit,curvedPanel(centre,width-.12,y0+.06,y1-.06,null,-.025,4,.025))
  const frontY = 1.85, count = 4, span = (frontY-EXIT_BACK_Y)/count
  const baseStart=EXIT_BACK_Y+.05, baseEnd=frontY-.11
  for (const sign of [-1,1]) {
    const x = centre + sign*side
    const base = slab(house, stone, x, (baseStart+baseEnd)/2, .48, .22, baseEnd-baseStart, .96)
    base.name = 'shenzhen-stone-plinth'; panelModelDetail(base)
    for (let i=0;i<count;i++) {
      const y = EXIT_BACK_Y+i*span
      const start=i===0?0:.96, height=shenzhenRoofHeight(y)-.06-start
      const post=slab(house,frame,x,y,start+height/2,.12,.10,height)
      post.name='shenzhen-glazing-mullion'; panelModelDetail(post)
      if(i<count) {
        const glass=new THREE.Mesh(curvedPanel(x,.035,y+.055,y+span-(i===count-1?.115:.055),1.005,-.06,8),ctx.mats.glass)
        house.add(glass)
        glass.name='shenzhen-side-glass'; setModelDetail(glass,curvedPanel(x,.035,y+.055,y+span-(i===count-1?.115:.055),1.005,-.06,1))
      }
    }
    const gasket=slab(house,frame,x,(baseStart+baseEnd)/2,.98,.07,baseEnd-baseStart,.04)
    gasket.name='shenzhen-glazing-base-gasket';panelModelDetail(gasket)
    const jamb = slab(house,frame,x,1.85,EXIT_H/2,.22,.22,EXIT_H)
    jamb.name='shenzhen-front-jamb';panelModelDetail(jamb)
    // One sign on the visitor's right (local -x), facing the street doorway (+y).
    if(sign !== -1) continue
    const bladeX = centre - half - .32
    const bracket=slab(house,frame,centre-half-.04,1.94,EXIT_H-.34,.18,.40,.045)
    bracket.name='shenzhen-metro-sign-bracket';omitModelDetail(bracket)
    const blade = slab(house,frame,bladeX,2.12,EXIT_H-.48,.48,.06,.60)
    blade.name='shenzhen-projecting-metro-sign';panelModelDetail(blade)
    if(typeof document !== 'undefined') {
      const map = canvasTexture(128,128,g=>{
        g.fillStyle='#242d32';g.fillRect(0,0,128,128)
        g.strokeStyle='#ffffff';g.lineWidth=3
        g.beginPath();g.roundRect(41,10,46,53,7);g.stroke()
        g.beginPath();g.roundRect(49,20,30,34,8);g.stroke()
        g.fillStyle='#ffffff';g.fillRect(54,27,20,13)
        for(const x of [55,73]){g.beginPath();g.arc(x,47,2,0,Math.PI*2);g.fill()}
        g.beginPath();g.moveTo(55,54);g.lineTo(48,61);g.moveTo(73,54);g.lineTo(80,61);g.stroke()
        g.textAlign='center';g.textBaseline='middle';g.font='26px "Microsoft YaHei",sans-serif'
        g.fillText(tForLanguage('zh-CN','metro'),64,85,110)
        g.font='bold 18px Arial,sans-serif';g.fillText(t('printed_metro'),64,111,110)
      })
      const ink=ownedMaterial(ctx,new THREE.MeshBasicMaterial({map}))
      const face=plate(house,ink,.44,.56,bladeX,2.155,EXIT_H-.48,Math.PI)
      face.name='shenzhen-front-metro-sign-face'
    }
  }
  const rearBottom=.965, rearTop=shenzhenRoofHeight(EXIT_BACK_Y)-.06
  const rear=slab(house,ctx.mats.glass,centre,EXIT_BACK_Y,(rearBottom+rearTop)/2,width-.39,.035,rearTop-rearBottom)
  rear.name='shenzhen-rear-glass';panelModelDetail(rear)
  // Recessed downlights sit below the soffit, visible from the street approach.
  for(const y of [1.75,-.5,-3])for(const x of [centre-width*.25,centre+width*.25]) {
    const light = new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.018,16),ctx.mats.glow)
    light.rotation.x=Math.PI/2;light.position.set(x,y,shenzhenRoofHeight(y)-.065);house.add(light)
    light.name='shenzhen-recessed-downlight';omitModelDetail(light)
  }
}
