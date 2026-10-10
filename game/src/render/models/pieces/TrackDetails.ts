import * as THREE from 'three'
import { slab, finishSlab } from '../PieceBuilder.ts'
import type { ModelMaterials } from '../PieceBuilder.ts'

/** Slab-track hardware (§5.4), batched so a long platform costs the same draw calls. */
export function buildTrackDetails(g: THREE.Group, mats: ModelMaterials, concrete: THREE.Material, railWeb: THREE.Material, w: number, d: number): void {
  const cx = (w - 1) / 2
  const cy = (d - 1) / 2
  const gauge = 0.7525 // 1.435 m between the inside faces of the 70 mm heads.
  for (const sign of [-1, 1]) {
    const y = cy + sign * gauge
    slab(g, railWeb, cx, y, 0.579, w, 0.15, 0.018)
    slab(g, railWeb, cx, y, 0.608, w, 0.022, 0.04)
    // Bevelled head: a broad polished crown above a narrow, darker web.
    const shape = new THREE.Shape()
    shape.moveTo(-0.029, 0.628)
    shape.lineTo(0.029, 0.628)
    shape.lineTo(0.035, 0.635)
    shape.lineTo(0.035, 0.645)
    shape.lineTo(0.027, 0.65)
    shape.lineTo(-0.027, 0.65)
    shape.lineTo(-0.035, 0.645)
    shape.lineTo(-0.035, 0.635)
    shape.closePath()
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, steps: 1, curveSegments: 1 })
    // Shape XY is the rail's YZ section; extrusion Z becomes the track's X.
    geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.5, 1, 0, 0, y, 0, 1, 0, 0, 0, 0, 0, 1))
    g.add(new THREE.Mesh(geo, mats.steel))
  }

  const n = Math.max(2, Math.round(w / 0.6))
  const positions = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * w - 0.5)
  const batch = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, points: Array<[number, number, number]>) => {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3))
    const mesh = new THREE.InstancedMesh(geo, mat, points.length)
    mesh.name = name
    const pose = new THREE.Matrix4()
    points.forEach(([x, y, z], i) => mesh.setMatrixAt(i, pose.makeTranslation(x, y, z)))
    mesh.instanceMatrix.needsUpdate = true
    g.add(mesh)
  }
  batch('concrete sleepers', new THREE.BoxGeometry(0.23, Math.min(2.42, Math.max(1.9, d - 0.3)), 0.08), concrete, positions.map(x => [x, cy, 0.53]))
  const seats: Array<[number, number, number]> = []
  const bolts: Array<[number, number, number]> = []
  const clips: Array<[number, number, number]> = []
  for (const x of positions) for (const sign of [-1, 1]) {
    const y = cy + sign * gauge
    seats.push([x, y, 0.567])
    for (const side of [-1, 1]) {
      clips.push([x, y + side * 0.085, 0.591])
      bolts.push([x, y + side * 0.135, 0.59])
    }
  }
  batch('rail seats', new THREE.BoxGeometry(0.19, 0.34, 0.014), mats.darkSteel, seats)
  const clipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.065, 0.022, 0), new THREE.Vector3(-0.045, -0.012, 0.014),
    new THREE.Vector3(0, -0.025, 0.018), new THREE.Vector3(0.045, -0.012, 0.014), new THREE.Vector3(0.065, 0.022, 0),
  ])
  batch('spring clips', new THREE.TubeGeometry(clipCurve, 8, 0.009, 5, false), mats.darkSteel, clips)
  const boltGeo = new THREE.CylinderGeometry(0.023, 0.023, 0.026, 6)
  boltGeo.rotateX(Math.PI / 2)
  batch('anchor bolts', boltGeo, mats.darkSteel, bolts)

  if (d >= 3) {
    for (const sign of [-1, 1]) {
      const y = cy + sign * (d / 2 - 0.15)
      slab(g, mats.black, cx, y, 0.466, w, 0.16, 0.025)
      for (const side of [-1, 1]) finishSlab(g, concrete, cx, y + side * 0.095, 0.48, w, 0.025, 0.035)
    }
  }
}
