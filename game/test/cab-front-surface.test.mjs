import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CabFrontSurface } from '../src/render/models/pieces/CabFrontSurface.ts'
import { cabShellGeometry } from '../src/render/models/pieces/TrainShell.ts'

test('indexed cab fitting rays preserve exact shell hits and misses at shoulders and cell seams', () => {
  for (const width of [2.6, 2.8, 3.3]) for (const segments of [1, 5]) {
    const geometry = cabShellGeometry(width, segments)
    const surface = new CabFrontSurface(geometry)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    const positions = geometry.attributes.position.array.slice()
    try {
      for (const outward of [-1, 1]) {
        mesh.rotation.z = outward < 0 ? Math.PI : 0
        mesh.position.set(outward*51.3, 0, 1.82); mesh.updateMatrixWorld(true)
        const inverse = mesh.matrixWorld.clone().invert(), hit = new THREE.Vector3()
        for (let yi = -12; yi <= 12; yi++) for (let zi = -12; zi <= 12; zi++) {
          // Includes exact bucket boundaries, rounded corners and misses.
          const origin = new THREE.Vector3(outward*55.3, yi*.125, 1.82+zi*.125)
          const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(-outward, 0, 0))
          const expected = raycaster.intersectObject(mesh, false)[0]?.point
          const actual = surface.intersect(raycaster.ray.clone().applyMatrix4(inverse), hit)
          assert.equal(!!actual, !!expected, `${width}/${segments}/${outward}: ${yi},${zi}`)
          if (actual) assert.ok(actual.clone().applyMatrix4(mesh.matrixWorld).distanceTo(expected)<1e-9)
        }
      }
      assert.deepEqual(geometry.attributes.position.array, positions, 'preparation and sampling never change source vertices')
    } finally { geometry.dispose(); mesh.material.dispose() }
  }
})

test('cab fitting sampling tests local triangles without reading the shell again', () => {
  const geometry = cabShellGeometry(3.3)
  const surface = new CabFrontSurface(geometry)
  const sourceTriangles = geometry.attributes.position.count/3
  const original = THREE.Ray.prototype.intersectTriangle
  let tests = 0, queries = 0
  THREE.Ray.prototype.intersectTriangle = function (...args) { tests++; return original.apply(this, args) }
  const attribute = geometry.attributes.position
  const getX = attribute.getX
  attribute.getX = () => { throw new Error('sampling must use its prepared local surface') }
  try {
    const ray = new THREE.Ray(new THREE.Vector3(4,0,0), new THREE.Vector3(-1,0,0))
    const hit = new THREE.Vector3()
    for (let y = -10; y <= 10; y++) for (let z = -8; z <= 8; z++) {
      ray.origin.set(4,y*.125,z*.125)
      assert.ok(surface.intersect(ray, hit)); queries++
    }
    assert.ok(tests < queries*sourceTriangles/10, `${tests} local triangle tests replace ${queries*sourceTriangles} full-shell tests`)
  } finally { attribute.getX = getX; THREE.Ray.prototype.intersectTriangle = original; geometry.dispose() }
})
