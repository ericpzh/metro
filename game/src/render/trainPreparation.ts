import type { StationData, Module } from '../sim/types.ts'
import { STOCK_CLASSES, trainOriginForScale, trainScaleForStorey } from '../sim/stock.ts'
import { trackFacing } from '../sim/track.ts'

type TrackModule = Extract<Module, { type: 'track' }>

/** Appearance-only poses for opening-time preparation. No service is dispatched:
 * the worker alone determines which of these trains is live and where it moves. */
export function trainPreparationPoses(data: StationData, limit: number): Float32Array {
  const poses: number[] = []
  const tracks = data.modules.filter((module): module is TrackModule => module.type === 'track')
  const screens = data.modules.filter(module => module.type === 'platform-edge')
  for (const line of data.lines) {
    const bound = tracks.filter(track => track.cfg.line === line.id)
    const platforms = bound.filter(track => !track.cfg.tunnel && !track.cfg.bridge)
    for (const track of platforms.length ? platforms : bound) {
      if (poses.length >= limit*10) break
      const direction = track.cfg.dir ?? line.direction
      let ownSides = 0, legacySides = 0
      for (const screen of screens) {
        if (screen.cfg.line !== line.id) continue
        const bit = screen.cfg.side === 'left' ? 1 : 2
        if (screen.cfg.from === track.id) ownSides |= bit
        else if (!screen.cfg.from && screen.cfg.dir === direction) legacySides |= bit
      }
      const [fx, fy] = trackFacing(track.rot)
      const sign = track.cfg.dir ? (track.cfg.dir === 'down' ? -1 : 1) : (line.travelSign ?? 1) >= 0 ? 1 : -1
      poses.push(track.x, track.y, track.z+trainOriginForScale(trainScaleForStorey(data.storeyHeight)),
        line.cars, STOCK_CLASSES.indexOf(line.stock), 0, parseInt(line.colour.replace('#',''),16) || 0x1f5fd0,
        sign, Math.atan2(fy,fx), (ownSides || legacySides) | (line.power === 'catenary' ? 4 : 0))
    }
  }
  // Match the worker protocol's float rounding (notably yaw) before keying models.
  return new Float32Array(poses)
}

/** One spare for each existing appearance, within the same bounded fleet. A new
 * platform can then reuse a prepared consist instead of building it on click. */
export function trainPreparationFleet(data: StationData, limit: number): Float32Array {
  const poses=Array.from(trainPreparationPoses(data,limit)), originals=poses.length
  const counts=new Map<string,number>()
  const shape=(i:number):string=>[poses[i+3],poses[i+4],poses[i+6],poses[i+7],poses[i+9]&4].join(':')
  for(let i=0;i<originals;i+=10)counts.set(shape(i),(counts.get(shape(i))??0)+1)
  for(let i=0;i<originals&&poses.length<limit*10;i+=10){
    const key=shape(i)
    if(counts.get(key)!>=2)continue
    counts.set(key,2);poses.push(...poses.slice(i,i+10))
  }
  return new Float32Array(poses)
}
