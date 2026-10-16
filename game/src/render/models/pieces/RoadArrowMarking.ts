import * as THREE from 'three'
import type { RoadTurn } from '../../../sim/roadLaneMovements.ts'

/** Flat painted shaft and arrowheads, local +Y forward, +X driver's right (§9.5). */
export function roadArrowMarking(material: THREE.Material, turns: readonly RoadTurn[], x: number, y: number, z: number, axis: boolean, sign: number, scale = 1): THREE.Mesh {
  const vertices: number[] = []
  const polygon = (points: number[][]) => {
    const contour = points.map(([px,py]) => new THREE.Vector2(px*scale,py*scale))
    for(const face of THREE.ShapeUtils.triangulateShape(contour,[])) for(const i of face) vertices.push(contour[i].x,contour[i].y,0)
  }
  polygon([[-.12,-1.3],[.12,-1.3],[.12,.25],[-.12,.25]])
  if(turns.includes('straight')) polygon([[-.12,.1],[.12,.1],[.12,.8],[.55,.8],[0,1.5],[-.55,.8],[-.12,.8]])
  const branch=[[0,-.15],[-.85,.4],[-.85,.1],[-1.4,.55],[-.85,1],[-.85,.7],[0,.15]]
  if(turns.includes('left')) polygon(branch)
  if(turns.includes('right')) polygon(branch.map(([px,py])=>[-px,py]))
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals()
  const mesh=new THREE.Mesh(geometry,material)
  mesh.name='road-direction-arrow';mesh.position.set(x,y,z)
  mesh.rotation.z=axis?(sign>0?0:Math.PI):(sign>0?-Math.PI/2:Math.PI/2)
  return mesh
}
