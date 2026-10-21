import * as THREE from 'three'

export interface TrainDoorFrame {
  outer: [number, number, number, number]
  hole: [number, number, number, number]
  front: number
  back: number
}

/** Two broad faces of a thin door frame, with a real glazing aperture (§1.13).
 * Build whole profile strips rather than clipping every source triangle at each
 * bend: coplanar diagonals need no extra vertices. Thin hidden edge walls are
 * omitted at Low; picking and all door transforms still use the full source.
 */
export function trainDoorLow(frame: TrainDoorFrame, cuts: readonly number[], offset: (z: number) => number): THREE.BufferGeometry {
  const [left,right,bottom,top]=frame.outer, [holeLeft,holeRight,holeBottom,holeTop]=frame.hole
  const levels=[...new Set([bottom,top,holeBottom,holeTop,...cuts].filter(z=>z>=bottom&&z<=top))].sort((a,b)=>a-b)
  const positions:number[]=[],indices:number[]=[]
  for(let row=0;row+1<levels.length;row++){
    const a=levels[row],b=levels[row+1],mid=(a+b)/2
    const spans=mid>holeBottom&&mid<holeTop?[[left,holeLeft],[holeRight,right]]:[[left,right]]
    for(const [x0,x1]of spans)for(const [y,reverse]of [[frame.front,false],[frame.back,true]] as const){
      const first=positions.length/3
      for(const [x,z]of [[x0,a],[x0,b],[x1,b],[x1,a]])positions.push(x,y+offset(z),z)
      indices.push(...(reverse?[first,first+2,first+1,first,first+3,first+2]:[first,first+1,first+2,first,first+2,first+3]))
    }
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals()
  return geometry
}
