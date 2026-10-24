// Pure bounded audio projection in the game's native Z-up coordinates.
export type AudioPoint = readonly [number, number, number]
export type AmbientKind = 'crowd' | 'train' | 'traffic'
export interface AmbientSource { kind: AmbientKind; position: AudioPoint; level: number }
export interface AudioSceneFrame { position: AudioPoint; right: AudioPoint; sources: AmbientSource[]; speed?: number }
export function sourceMix(position: AudioPoint, right: AudioPoint, source: AmbientSource): {gain:number; pan:number} {
  const dx=source.position[0]-position[0],dy=source.position[1]-position[1],dz=source.position[2]-position[2]
  const distance=Math.hypot(dx,dy,dz),reference=source.kind==='crowd'?18:28,radius=source.kind==='crowd'?160:240
  const fade=Math.max(0,Math.min(1,(radius-distance)/(radius*.2)))
  return {gain:source.level*reference/Math.max(reference,distance)*fade,
    pan:distance?Math.max(-1,Math.min(1,(dx*right[0]+dy*right[1]+dz*right[2])/distance)):0}
}
/** At most 256 passenger samples and one crowd bed, independent of population. */
export function crowdSound(buffer: Float32Array, count: number, camera: AudioPoint): AmbientSource | null {
  count=Math.min(count,Math.floor(buffer.length/6))
  if(!count)return null
  const buckets=new Map<string,{x:number;y:number;z:number;count:number}>(),step=Math.max(1,Math.ceil(count/256))
  for(let i=0;i<count;i+=step){
    const o=i*6,x=buffer[o],y=buffer[o+1],z=buffer[o+2]
    if(!Number.isFinite(x+y+z))continue
    const key=`${Math.floor(x/16)},${Math.floor(y/16)},${Math.floor(z/5)}`
    const bucket=buckets.get(key)??{x:0,y:0,z:0,count:0}
    bucket.x+=x;bucket.y+=y;bucket.z+=z;bucket.count++;buckets.set(key,bucket)
  }
  let best:AmbientSource|null=null,score=0
  for(const b of buckets.values()){
    const source:AmbientSource={kind:'crowd',position:[b.x/b.count,b.y/b.count,b.z/b.count],level:Math.min(.65,.12+Math.log2(1+b.count*step)*.09)}
    const gain=sourceMix(camera,[1,0,0],source).gain
    if(gain>score){score=gain;best=source}
  }
  return best
}
