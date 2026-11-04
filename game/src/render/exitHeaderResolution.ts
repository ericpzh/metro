import type { CityStyle } from '../sim/cityStyles.ts'

/** Keep the authored layout in logical pixels, with sharper Chengdu print. */
export function exitHeaderScale(city?:CityStyle):number { return city==='chengdu'||city==='chongqing'||city==='wuhan'?4:1 }
export function exitHeaderResolution(logicalWidth:number,city?:CityStyle):{width:number;height:number} {
  const width=Math.min(4096,Math.round(logicalWidth*exitHeaderScale(city)))
  return {width,height:Math.round(width*96/logicalWidth)}
}
