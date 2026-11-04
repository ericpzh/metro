import type * as THREE from 'three'
import type { CityStyle } from '../sim/cityStyles.ts'
import { drawChongqingTrainBadge } from './chongqingBranding.ts'

/** Each prepared/live consist owns one retained badge; colour never identifies its line. */
export function refreshChongqingTrainMark(material:THREE.MeshBasicMaterial,city:CityStyle|undefined,line:string,colour:string):void {
  const key=city==='chongqing'?`${line}|${colour}`:''
  if(material.userData.badgeKey===key)return
  const canvas=material.map?.image as HTMLCanvasElement|undefined,g=canvas?.getContext('2d')
  if(!canvas||!g||!material.map)return
  g.clearRect(0,0,canvas.width,canvas.height)
  if(city==='chongqing')drawChongqingTrainBadge(g,line,colour,canvas.width,canvas.height)
  material.map.needsUpdate=true;material.userData.badgeKey=key
}
