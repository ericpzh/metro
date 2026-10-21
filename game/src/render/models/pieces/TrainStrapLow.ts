import * as THREE from 'three'

/** A hanging loop stays hollow: two broad triangular ribbons, not a solid slab. */
export function trainStrapLow(path: THREE.Curve<THREE.Vector3>, radius: number): THREE.BufferGeometry {
  const points=[0,1/3,2/3].map(t=>path.getPoint(t)),center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/3)
  const outer=points.map(p=>p.clone().add(p.clone().sub(center).normalize().multiplyScalar(radius)))
  const inner=points.map(p=>p.clone().add(p.clone().sub(center).normalize().multiplyScalar(-radius)))
  const positions:number[]=[],indices:number[]=[]
  for(const side of [-1,1])for(let i=0;i<3;i++){
    const j=(i+1)%3,first=positions.length/3
    for(const p of [outer[i],inner[i],inner[j],outer[j]])positions.push(p.x,p.y+side*radius/2,p.z)
    indices.push(...(side>0?[first,first+2,first+1,first,first+3,first+2]:[first,first+1,first+2,first,first+2,first+3]))
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals()
  return geometry
}
