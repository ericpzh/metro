import * as THREE from 'three'

/** Thin window frames retain both broad faces and the real aperture (§1.12).
 * Their narrow extrusion edges are invisible at Low's working distance. */
export function trainWindowLow(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const face=new THREE.ShapeGeometry(shape,1),p=face.attributes.position,uv=face.attributes.uv
  const positions:number[]=[],uvs:number[]=[],indices:number[]=[]
  for(const y of [-depth/2,depth/2])for(let i=0;i<p.count;i++){
    positions.push(p.getX(i),y,p.getY(i));uvs.push(uv.getX(i),uv.getY(i))
  }
  const source=face.index!
  for(let i=0;i<source.count;i+=3){const a=source.getX(i),b=source.getX(i+1),c=source.getX(i+2);indices.push(a,b,c,a+p.count,c+p.count,b+p.count)}
  face.dispose()
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals()
  return geometry
}
