// Adjoining ramp balustrades share a steel infill cap, not a third handrail (§5.1).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'
import { createModule } from '../src/build/model.ts'
import { stairFacing } from '../src/sim/stairs.ts'

const mats = new Proxy({}, { get: (o, k) => o[k] ??= new THREE.MeshStandardMaterial() })
function joins(modules, cells = []) {
  const ctx = { mats, data: { name: 'joins', seed: 1, cells, modules, lines: [] }, preview: false }
  return modules.filter((m) => m.type === 'escalator').flatMap((mod) => {
    const g = new EscalatorModel(ctx).build(mod)
    g.updateMatrixWorld(true)
    return g.children.filter((o) => o.name === 'ramp-join').map((mesh) => ({ group: g, mesh, bounds: new THREE.Box3().setFromObject(mesh, true), owner: mod.id, domes: g.children.filter((o) => o.name === 'ramp-join-dome' && o.userData.neighbourId === mesh.userData.neighbourId) }))
  })
}
const escalator = (x, id, rot = 0, width = 1, dir = 'up', y = 0, z = 0) => createModule('escalator', x, y, z, id, rot, width, dir)

test('one metal cap fills every shared escalator seam, in all rotations and travel directions', () => {
  for (let rot = 0; rot < 4; rot++) for (const width of [1, 2]) for (const dir of ['up', 'down']) {
    const [dx, dy] = stairFacing(rot)
    const a = escalator(0, 'a', rot, width, dir)
    const b = escalator(width * dy, 'b', rot, 1, dir === 'up' ? 'down' : 'up', -width * dx)
    const caps = joins([a, b])
    assert.equal(caps.length, 1, 'a shared seam is never drawn by both modules')
    assert.equal(caps[0].owner, 'a')
    assert.equal(caps[0].mesh.material, mats.steel)
    const size = caps[0].bounds.getSize(new THREE.Vector3())
    assert.ok((dx === 0 ? size.y : size.x) > 5, 'cap follows the full incline between the rounded rail ends')
    assert.ok(Math.abs((dx === 0 ? size.x : size.y) - 0.32) < 1e-5, 'fills the 28 cm gap and overlaps each rail by 2 cm')
    assert.equal(joins([b, a]).length, 1, 'document order does not duplicate or remove the seam')
    assert.equal(joins([a]).length, 0, 'removing the neighbour removes the connector')
  }
})

test('a bank of three escalators has two caps, with none along its outer edges', () => {
  assert.equal(joins([escalator(0, 'a'), escalator(1, 'b'), escalator(2, 'c')]).length, 2)
})

test('shared infill seals both rounded ends with closed metal surfaces', () => {
  for (const other of [escalator(1, 'b', 0, 1, 'down'), createModule('stair-straight', 1, 0, 0, 'stairs')]) {
    const { mesh, bounds } = joins([escalator(0, 'a'), other])[0]
    assert.ok(bounds.min.z < 1, 'lower end closes below the supporting floor')
    if (other.type === 'escalator') assert.ok(bounds.max.y > 6.5 && bounds.min.y < 0.5, 'matching returns extend past the landing centreline')
    else {
      assert.ok(bounds.min.y >= 1 - 1e-5 && bounds.max.y < 6.01, 'mixed connector stops at the shorter straight railing')
      const world = mesh.geometry.getAttribute('position')
      let lowerFace = 0, upperFace = 0
      for (let i = 0; i < world.count; i += 3) {
        const v = [0,1,2].map((j) => new THREE.Vector3().fromBufferAttribute(world,i+j).applyMatrix4(mesh.matrixWorld))
        const normal = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize()
        if (Math.abs(normal.y) < 0.999) continue
        const height = Math.max(...v.map((p) => p.z)) - Math.min(...v.map((p) => p.z))
        if (height < 0.8) continue
        if (v.every((p) => Math.abs(p.y - bounds.min.y) < 1e-5)) lowerFace++
        if (v.every((p) => Math.abs(p.y - bounds.max.y) < 1e-5)) upperFace++
      }
      assert.ok(lowerFace >= 2 && upperFace >= 2, 'both cut ends have full-height vertical metal faces')
    }
    const positions = mesh.geometry.getAttribute('position')
    const edges = new Map()
    const vertex = (i) => new THREE.Vector3().fromBufferAttribute(positions,i)
    const key = (v) => v.toArray().map((x) => Math.round(x * 100000)).join(',')
    for (let i = 0; i < positions.count; i += 3) {
      const vertices = [vertex(i),vertex(i+1),vertex(i+2)]
      assert.ok(vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).length() > 1e-9, 'no collapsed strip leaves an open nose')
      for (const [a,b] of [[0,1],[1,2],[2,0]]) {
        const edge = [key(vertices[a]),key(vertices[b])].sort().join('|')
        edges.set(edge,(edges.get(edge)??0)+1)
      }
    }
    for (const count of edges.values()) assert.equal(count,2,'each shell edge belongs to exactly two faces')
  }
})

test('centreline bumps are hemispheres seated on the sloping metal panel', () => {
  const { domes } = joins([escalator(0,'a'),escalator(1,'b')])[0]
  assert.ok(domes.length >= 3, 'a row of bumps follows the incline')
  const cos = 6 / Math.hypot(6,4)
  for (const dome of domes) {
    const bounds = new THREE.Box3().setFromObject(dome)
    assert.ok(Math.abs((bounds.min.x + bounds.max.x) / 2 - 1) < 1e-5, 'bump is centred between the two rails')
    const positions = dome.geometry.getAttribute('position')
    let min = Infinity, max = -Infinity
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(dome.matrixWorld)
      const height = (p.z - (1 + 1 / cos + (p.y - 0.5) * 4 / 6 - 0.045)) * cos
      min = Math.min(min,height);max = Math.max(max,height)
    }
    assert.ok(Math.abs(min) < 1e-5, 'the flat base sits on the cap')
    assert.ok(Math.abs(max - 0.065) < 1e-4, 'a 65 mm hemisphere rises above the cap, with no lower sphere poking through')
  }
})

test('stair-escalator caps meet the real facing rails on either side', () => {
  for (let rot = 0; rot < 4; rot++) for (const side of [-1, 1]) {
    const [dx, dy] = stairFacing(rot)
    const e = escalator(0, 'e', rot)
    const s = createModule('stair-straight', side * dy, -side * dx, 0, 's', rot)
    const caps = joins([e, s])
    assert.equal(caps.length, 1)
    assert.equal(caps[0].mesh.userData.neighbourId, 's')
    const positions = caps[0].mesh.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getZ(i)), 'mixed slopes form a finite closed cap')
  }
})

test('stair connections drop vertically to a shelf instead of slanting across the gap', () => {
  for (let rot = 0; rot < 4; rot++) for (const side of [-1, 1]) for (const dir of ['up', 'down']) {
    const [dx,dy] = stairFacing(rot)
    const e = escalator(0, 'e', rot, 1, dir)
    const s = createModule('stair-straight', side * dy, -side * dx, 0, 's', rot)
    const { mesh, group, domes } = joins([e,s])[0]
    const glass = group.children.filter((o) => o.isMesh && o.material === mats.glass)
    assert.equal(glass.length, 1, 'only the outer escalator panel remains glass')
    const axis = new THREE.Vector3(dx,dy,0)
    const across = new THREE.Vector3(-dy,dx,0)
    const positions = mesh.geometry.getAttribute('position')
    const origin = new THREE.Vector3(0.5,0.5,1).dot(axis)
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld)
      const u = p.dot(axis) - origin
      assert.ok(u >= 0.5 - 1e-5 && u <= 6 - 4 / Math.hypot(6,4) + 1e-5,
        'metal stops at the shorter railing at both ends, in either direction')
    }
    let longFaces = 0
    let stairSkinFaces = 0
    for (let i = 0; i < positions.count; i += 3) {
      const vertices = [0,1,2].map((j) => new THREE.Vector3().fromBufferAttribute(positions,i+j).applyMatrix4(mesh.matrixWorld))
      const along = vertices.map((p) => p.dot(axis))
      if (Math.max(...along) - Math.min(...along) < 2) continue
      longFaces++
      const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize()
      const transverse = Math.abs(normal.dot(across))
      assert.ok(transverse < 1e-5 || transverse > 0.99999, 'main faces are vertical cheeks or shelves with no cross-gap tilt')
      const centreOffset = vertices[0].clone().sub(new THREE.Vector3(0.5,0.5,1)).dot(across)
      if (Math.abs(centreOffset + side * 0.61) < 1e-5 && normal.dot(across) * -side > 0.99999) {
        const heights = vertices.map((p) => p.z)
        assert.ok(Math.max(...heights) - Math.min(...heights) > 3, 'stair skin spans the full incline')
        stairSkinFaces++
      }
    }
    assert.ok(longFaces >= 8, 'both the vertical cheek and shelf follow the incline')
    assert.equal(stairSkinFaces, 2, 'continuous outward-facing metal seals the stair side beneath the shelf')
    for (const dome of domes) {
      const p = dome.geometry.getAttribute('position')
      let minimum = Infinity
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(dome.matrixWorld)
        const u = v.dot(axis)
        minimum = Math.min(minimum, v.z - (1.905 + (u - origin - 0.5) * 0.8))
      }
      assert.ok(Math.abs(minimum) < 1e-5, 'hemisphere base rests on the stair-height shelf')
    }
  }
})

test('separated, staggered, crossing and differently elevated runs do not grow caps', () => {
  const e = escalator(0, 'e')
  for (const other of [escalator(2, 'far'), escalator(1, 'stagger', 0, 1, 'up', 1), escalator(1, 'cross', 1), escalator(1, 'high', 0, 1, 'up', 0, 4)]) {
    assert.equal(joins([e, other]).length, 0, `${other.id} is not a flush adjoining run`)
  }
  const block = createModule('stair-block', 1, 0, 0, 'block')
  assert.equal(joins([e, block]).length, 0, 'stair blocks have no matching balustrade')
})
