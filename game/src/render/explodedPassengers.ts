import { AgentState, packKey } from '../sim/types.ts'
import type { StationData } from '../sim/types.ts'
import { STOREY_HEIGHT, storeyBand } from '../sim/constants.ts'
import { stairFlights } from '../sim/stairs.ts'
import { moduleFootprint } from '../sim/placement.ts'

/** Prepared once from the geometry actually retained by the exploded view. */
export function explodedPassengerSupport(data: StationData, offsets: ReadonlyMap<number,number>, direction: readonly [number,number]): Set<number> {
  const solids = new Set(data.cells.filter(c=>c.fill==='solid').map(c=>packKey(c.x,c.y,c.z)))
  const support = new Set(data.cells.filter(c=>c.fill==='solid'&&!solids.has(packKey(c.x,c.y,c.z+1))).map(c=>packKey(c.x,c.y,c.z)))
  const band = (z:number): number => storeyBand(z,data.levelBase??0,STOREY_HEIGHT)
  for(const m of data.modules) {
    if(m.type==='track') for(const [x,y] of moduleFootprint(m)) support.add(packKey(x,y,m.z))
    if(m.type==='lift') {
      for(const [x,y] of moduleFootprint(m)) for(let z=Math.min(m.from.z,m.to.z);z<=Math.max(m.from.z,m.to.z);z++) support.add(packKey(x,y,z))
    }
    if(m.type!=='stair'&&m.type!=='escalator'&&m.type!=='walkway') continue
    const flights = m.type==='stair'?stairFlights(m):[{from:m.from,to:m.to}]
    for(const flight of flights) {
      const a=flight.from,b=flight.to
      const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2))
      const width=m.type==='stair'?Math.ceil((m.cfg.width??1)/2):1
      for(let i=0;i<=steps;i++) {
        const t=i/steps,z=a.z+(b.z-a.z)*t
        const shift=(offsets.get(band(z+1))??0)-(offsets.get(band(m.z))??0)
        const x=Math.floor(a.x+.5+(b.x-a.x)*t+direction[0]*shift)
        const y=Math.floor(a.y+.5+(b.y-a.y)*t+direction[1]*shift)
        for(let dx=-width;dx<=width;dx++) for(let dy=-width;dy<=width;dy++) support.add(packKey(x+dx,y+dy,Math.floor(z+1e-3)))
      }
    }
  }
  return support
}

/** Compact an owned presentation buffer; never remove anyone from the simulation. */
export function filterExplodedPassengers(buffer: Float32Array,count:number,support:ReadonlySet<number>): number {
  let shown=0
  for(let i=0;i<count;i++) {
    const at=i*6, floor=Math.floor(buffer[at+2]-1+1e-3)
    if(buffer[at+3]!==AgentState.Riding &&
      !support.has(packKey(Math.floor(buffer[at]),Math.floor(buffer[at+1]),floor))) continue
    if(shown!==i) buffer.copyWithin(shown*6,at,at+6)
    shown++
  }
  return shown
}
