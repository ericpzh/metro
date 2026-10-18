import * as THREE from 'three'
import type { ModelMaterials } from '../PieceBuilder.ts'
import { slab } from '../PieceBuilder.ts'
import { omitModelDetail, setModelDetail } from '../../modelDetail.ts'
import { PANTOGRAPH_WELL_HALF_LENGTH } from './TrainPantograph.ts'

/** Shallow packaged HVAC units, fitted between cab seams and collector wells. */
export function buildTrainRoofAc(g: THREE.Group, mats: ModelMaterials, start: number, end: number, roof: number, pantographX?: number): void {
  const length = Math.min(2.8, (end - start) * .30), half = length / 2
  if (length < 1) return
  const base = roof - .02, height = .17, width = 1.5
  for (let x of [start + (end - start) * .25, start + (end - start) * .75]) {
    if (pantographX !== undefined) {
      const clearance = PANTOGRAPH_WELL_HALF_LENGTH + half + .16
      if (Math.abs(x - pantographX) < clearance) x = pantographX + Math.sign(x - pantographX || 1) * clearance
    }
    if (x - half < start || x + half > end) continue
    const profile = new THREE.Shape()
    profile.moveTo(-half, base); profile.lineTo(-half, base + .05)
    profile.lineTo(-half + .30, base + height); profile.lineTo(half - .30, base + height)
    profile.lineTo(half, base + .05); profile.lineTo(half, base); profile.closePath()
    const geometry = new THREE.ExtrudeGeometry(profile, {depth:width,bevelEnabled:false})
    geometry.rotateX(Math.PI/2); geometry.translate(x,width/2,0)
    const housing = new THREE.Mesh(geometry,mats.trainBody)
    housing.name = 'train-roof-ac-housing'
    setModelDetail(housing,new THREE.BoxGeometry(length,width,height).translate(x,0,base+height/2))
    g.add(housing)
    const detail = (name: string, material: THREE.Material, cx: number, cy: number, cz: number, w: number, d: number, h: number) => {
      const part = slab(g,material,cx,cy,cz,w,d,h)
      part.name = `train-roof-ac-${name}`; omitModelDetail(part); return part
    }
    for (const side of [-1,1]) {
      for (let i=0;i<8;i++) detail('side-vent',mats.darkSteel,x-half+.5+i*(length-1)/7,side*(width/2+.003),base+.08,.08,.009,.035)
      for (const end of [-1,1]) detail('mounting-foot',mats.darkSteel,x+end*(half-.4),side*.60,base-.015,.22,.14,.07)
    }
    for (const end of [-1,1]) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.009,24),mats.trainDark)
      fan.rotation.x=Math.PI/2; fan.position.set(x+end*.43,0,base+height+.003)
      fan.name='train-roof-ac-fan-grille'
      setModelDetail(fan,new THREE.CylinderGeometry(.25,.25,.009,6));g.add(fan)
      for(let line=-4;line<=4;line++) detail('fan-guard',mats.steel,x+end*.43,line*.05,base+height+.009,2*Math.sqrt(.25**2-(line*.05)**2),.012,.009)
    }
    for(const end of [-1,1]) for(let n=0;n<7;n++) detail('condenser-grille',mats.darkSteel,x+end*(half-.43),-.30+n*.10,base+height+.003,.30,.025,.006)
  }
}
