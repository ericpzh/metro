// Adjoining ramp balustrades share a steel infill cap, not a third handrail (§5.1).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'
import { createModule } from '../src/build/model.ts'
import { stairFacing, stairFlights } from '../src/sim/stairs.ts'
import { RAMP_LENGTHS, rampLengthSpec } from '../src/sim/rampLengths.ts'
import { RAMP_JOIN_DOME_RADIUS } from '../src/sim/constants.ts'

const mats = new Proxy({}, { get: (o, k) => o[k] ??= new THREE.MeshStandardMaterial() })
function joins(modules, cells = []) {
  const ctx = { mats, data: { name: 'joins', seed: 1, cells, modules, lines: [] }, preview: false }
  return modules.filter((m) => m.type === 'escalator').flatMap((mod) => {
    const g = new EscalatorModel(ctx).build(mod)
    g.updateMatrixWorld(true)
    return g.children.filter((o) => o.name === 'ramp-join').map((mesh) => ({ group: g, mesh, bounds: new THREE.Box3().setFromObject(mesh, true), owner: mod.id, domes: g.children.filter((o) => o.name === 'ramp-join-dome' && o.userData.neighbourId === mesh.userData.neighbourId) }))
  })
}
function assertDomeSeated(dome, mesh, normal) {
  const p = dome.geometry.getAttribute('position')
  let min = Infinity
  const points = []
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(dome.matrixWorld)
    const projection = v.dot(normal)
    min = Math.min(min, projection)
    points.push([v, projection])
  }
  const base = points.filter(([, projection]) => projection - min < 1e-5).map(([v]) => v)
  const max = Math.max(...points.map(([, projection]) => projection))
  assert.ok(base.length > 0, 'hemisphere has a flat base')
  const centre = base.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / base.length)
  const vertices = mesh.geometry.getAttribute('position')
  let closest = Infinity
  const point = new THREE.Vector3()
  for (let i = 0; i < vertices.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld)
    const b = new THREE.Vector3().fromBufferAttribute(vertices, i + 1).applyMatrix4(mesh.matrixWorld)
    const c = new THREE.Vector3().fromBufferAttribute(vertices, i + 2).applyMatrix4(mesh.matrixWorld)
    new THREE.Triangle(a, b, c).closestPointToPoint(centre, point)
    closest = Math.min(closest, point.distanceTo(centre))
  }
  assert.ok(closest < 0.001, `hemisphere base sits on its metal panel (${closest.toFixed(4)} m away)`)
  return max - min
}
const escalator = (x, id, rot = 0, width = 1, dir = 'up', y = 0, z = 0, length = 'long') => createModule('escalator', x, y, z, id, rot, width, dir, 'lane', [], undefined, { rampLength: length })
const stair = (x, id, rot = 0, length = 'long') => createModule('stair-straight', x, 0, 0, id, rot, 0.68, 'up', 'lane', [], undefined, { rampLength: length })
function escalatorPairedWithStair(x, id, rot, dir, y, z, length, stairX = x + 1, stairY = y) {
  const s = createModule('stair-straight', stairX, stairY, z, `${id}-stair`, rot, 0.68, 'up', 'lane', [], undefined, { rampLength: length })
  const flight = stairFlights(s)[0]
  const e = escalator(x, id, rot, 1, dir, y, z, length)
  const low = e.from.z < e.to.z ? e.from : e.to
  const d = { x: flight.to.x - flight.from.x, y: flight.to.y - flight.from.y, z: flight.to.z - flight.from.z }
  const high = { x: low.x + d.x, y: low.y + d.y, z: low.z + d.z }
  e.from = dir === 'up' ? low : high
  e.to = dir === 'up' ? high : low
  return [e, s]
}

test('one metal cap fills every shared escalator seam, in all rotations and travel directions', () => {
  for (let rot = 0; rot < 4; rot++) for (const width of [1, 2, 3]) for (const dir of ['up', 'down']) {
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
  const caps = joins([escalator(0, 'a'), escalator(1, 'b'), escalator(2, 'c')])
  assert.equal(caps.length, 2)
  // The outer pair stands one empty block apart only through the middle run;
  // the widened span must stop at the nearest escalator instead of crossing it.
  for (const { bounds } of caps) assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 0.32) < 1e-5)
})

test('parallel escalators one empty block apart share a widened cap', () => {
  for (let rot = 0; rot < 4; rot++) for (const width of [1, 2, 3]) for (const otherWidth of [1, 2, 3]) for (const dir of ['up', 'down']) {
    const [dx, dy] = stairFacing(rot)
    const a = escalator(0, 'a', rot, width, dir)
    const b = escalator((width + 1) * dy, 'b', rot, otherWidth, dir === 'up' ? 'down' : 'up', -(width + 1) * dx)
    const caps = joins([a, b])
    assert.equal(caps.length, 1, 'the empty block is bridged by one cap')
    assert.equal(caps[0].owner, 'a')
    assert.equal(caps[0].mesh.material, mats.steel)
    const size = caps[0].bounds.getSize(new THREE.Vector3())
    assert.ok((dx === 0 ? size.y : size.x) > 5, 'cap follows the full incline')
    assert.ok(Math.abs((dx === 0 ? size.x : size.y) - 1.32) < 1e-5, 'spans the block plus the rail gap and overlaps')
    assert.equal(joins([b, a]).length, 1, 'document order does not duplicate or remove the seam')
    assert.equal(joins([a]).length, 0, 'removing the neighbour removes the connector')
  }
  // Clearance of two blocks is past the span.
  assert.equal(joins([escalator(0, 'a'), escalator(3, 'b', 0, 1, 'down')]).length, 0)
  // A stair between the two runs stops the span just as a third escalator does.
  const [near, stair] = escalatorPairedWithStair(0, 'a', 0, 'up', 0, 0, 'long', 1)
  const far = escalator(2, 'b', 0, 1, 'down')
  assert.equal(joins([near, stair, far]).filter((cap) => cap.mesh.userData.neighbourId === 'b').length, 0, 'a stair in the gap is not spanned')
  // Stairs only share a seam flush against the escalator.
  const [e, s] = escalatorPairedWithStair(0, 'e', 0, 'up', 0, 0, 'long', 2)
  assert.equal(joins([e, s]).length, 0, 'a stair one block away is not bridged')
})

test('objects and blocks crossing the widened span prevent the cap', () => {
  const a = escalator(0, 'a'), b = escalator(2, 'b')
  const obstacle = createModule('bench', 1, 3, 2, 'obstacle', 0)
  assert.equal(joins([a, b, obstacle]).length, 0, 'equipment in the sloping span blocks the connector')
  assert.equal(joins([a, b], [{ x: 1, y: 3, z: 3, fill: 'solid' }, { x: 1, y: 3, z: 2, fill: 'solid' }]).length, 0, 'a solid block blocks the connector')
  assert.equal(joins([a, b], [{ x: 1, y: 3, z: -5, fill: 'solid' }]).length, 1, 'a block well below the connector does not block it')
  const crossing = stair(1, 'crossing', 1)
  assert.equal(joins([a, b, crossing]).filter(cap => cap.mesh.userData.neighbourId === 'b').length, 0, 'a crossing stair blocks the connector')
})

test('Tianhe escalator at (-11, -67, -10) joins beside the existing run', () => {
  const existing = escalator(-9, 'escalator-409', 2, 1, 'up', -67, -10)
  const placed = escalator(-11, 'preview-escalator', 2, 1, 'up', -67, -10)
  assert.equal(joins([existing, placed]).filter(cap => cap.mesh.userData.neighbourId === existing.id).length, 1)
})

test('isolated floor courses above an open middle shaft allow a widened cap', () => {
  const a = escalator(0, 'a'), b = escalator(2, 'b')
  const slab = { x: 1, y: 3, z: 3, fill: 'solid' }
  assert.equal(joins([a, b], [slab]).length, 1, 'one floor course over the cleared shaft does not block the cap')
  assert.equal(joins([a, b], [slab, { ...slab, x: 0 }, { ...slab, x: 2 }]).length, 1, 'uncarved upper floor beside a preview does not block the cap')
  assert.equal(joins([a, b], [slab, { ...slab, z: 0 }]).length, 1, 'floor courses separated by two empty cells allow the cap')
  assert.equal(joins([a, b], [slab, { ...slab, z: 1 }]).length, 0, 'a closer second course blocks the cap')
})

test('a run that ends beyond one landing does not suppress a widened seam', () => {
  // Saved 天河公园 geometry: two 2-block 三层 escalators at y = -104 and -101,
  // with a stair on the same lane but four cells past their lower landing. The
  // stair is between them across the plan, yet clear of the cap along the run.
  const a = {
    id: 'escalator-137', type: 'escalator', storeyHeight: 5, x: 164, y: -104, z: -20, rot: 3,
    from: { x: 164, y: -104, z: -20 }, to: { x: 138, y: -104, z: -5 },
    cfg: { incline: 30, dir: 'up', width: 2 },
  }
  const b = {
    id: 'escalator-138', type: 'escalator', storeyHeight: 5, x: 164, y: -101, z: -20, rot: 3,
    from: { x: 138, y: -101, z: -5 }, to: { x: 164, y: -101, z: -20 },
    cfg: { incline: 30, dir: 'down', width: 2 },
  }
  const stair = {
    id: 'stair-straight-138', type: 'stair', storeyHeight: 5, x: 191, y: -102, z: -20, rot: 3,
    from: { x: 191, y: -102, z: -20 }, to: { x: 168, y: -102, z: -5 },
    cfg: { width: 2.04, style: 'straight', flights: [{ from: { x: 191, y: -102, z: -20 }, to: { x: 168, y: -102, z: -5 } }] },
  }
  const caps = joins([a, b, stair])
  assert.equal(caps.length, 1, 'the two escalators share their widened cap')
  const size = caps[0].bounds.getSize(new THREE.Vector3())
  assert.ok(Math.abs(size.y - 1.32) < 1e-5, 'the cap spans the one empty block')
  // The same stair moved onto the seam does suppress it.
  const onSeam = { ...stair, x: 171, from: { x: 171, y: -102, z: -20 }, to: { x: 148, y: -102, z: -5 }, cfg: { ...stair.cfg, flights: [{ from: { x: 171, y: -102, z: -20 }, to: { x: 148, y: -102, z: -5 } }] } }
  assert.equal(joins([a, b, onSeam]).length, 0, 'a stair overlapping the seam stops the span')
})

test('shared infill seals both rounded ends with closed metal surfaces', () => {
  const mixedPair = escalatorPairedWithStair(0, 'a', 0, 'up', 0, 0, 'long')
  for (const pair of [[escalator(0, 'a'), escalator(1, 'b', 0, 1, 'down')], [escalator(0, 'a'), escalator(2, 'b', 0, 1, 'down')], [escalator(0, 'a', 0, 3, 'up'), escalator(3, 'b', 0, 3, 'down')], mixedPair]) {
    const [own, other] = pair
    const { mesh, bounds } = joins([own, other])[0]
    assert.ok(bounds.min.z < 1, 'lower end closes below the supporting floor')
    if (other.type === 'escalator') assert.ok(bounds.max.y > 6.5 && bounds.min.y < 0.5, 'matching returns extend past the landing centreline')
    else {
      assert.ok(bounds.min.y >= 1 - 1e-5 && bounds.max.y < 9.01, 'mixed connector stays within matching five-metre rails')
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

test('dome columns are hemispheres seated on the sloping metal panel', () => {
  // A flush 0.32 m cap keeps one centreline row at the original size. A widened
  // 1.32 m cap spreads two evenly spaced rows of twice-size domes.
  for (const [pair, centres, radius] of [
    [[escalator(0, 'a'), escalator(1, 'b')], [1], RAMP_JOIN_DOME_RADIUS],
    [[escalator(0, 'a'), escalator(2, 'b')], [1.17, 1.83], RAMP_JOIN_DOME_RADIUS * 2],
    [[escalator(0, 'a'), escalator(-2, 'b')], [-0.83, -0.17], RAMP_JOIN_DOME_RADIUS * 2],
    [[escalator(0, 'a', 0, 3), escalator(3, 'b', 0, 3)], [3], RAMP_JOIN_DOME_RADIUS],
  ]) {
    const { domes, mesh } = joins(pair)[0]
    assert.ok(domes.length >= 3 * centres.length, 'every column follows the incline')
    const normal = new THREE.Vector3(0, -5, 9).normalize()
    const hit = new Set()
    for (const dome of domes) {
      const bounds = new THREE.Box3().setFromObject(dome)
      const x = (bounds.min.x + bounds.max.x) / 2
      const column = centres.findIndex((centre) => Math.abs(centre - x) < 1e-5)
      assert.ok(column >= 0, `bump is centred in one of the cap's columns (${x})`)
      hit.add(column)
      assert.ok(Math.abs(assertDomeSeated(dome, mesh, normal) - radius) < 1e-4, 'the hemisphere rises above the cap at its own size')
    }
    assert.equal(hit.size, centres.length, 'both widened columns are populated')
  }
})

test('stair-escalator caps meet the real facing rails on either side', () => {
  for (let rot = 0; rot < 4; rot++) for (const side of [-1, 1]) {
    const [dx, dy] = stairFacing(rot)
    const [e, s] = escalatorPairedWithStair(0, 'e', rot, 'up', 0, 0, 'long', side * dy, -side * dx)
    const caps = joins([e, s])
    assert.equal(caps.length, 1)
    assert.equal(caps[0].mesh.userData.neighbourId, 'e-stair')
    const positions = caps[0].mesh.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getZ(i)), 'mixed slopes form a finite closed cap')
  }
})

test('stair connections drop vertically to a shelf instead of slanting across the gap', () => {
  for (let rot = 0; rot < 4; rot++) for (const side of [-1, 1]) for (const dir of ['up', 'down']) {
    const [dx,dy] = stairFacing(rot)
    const [e, s] = escalatorPairedWithStair(0, 'e', rot, dir, 0, 0, 'long', side * dy, -side * dx)
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
      assert.ok(u >= 0.5 - 1e-5 && u <= 8 - 5 / Math.hypot(8,5) + 1e-5,
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
      // One-block stair: 0.79 m treads, rail centre 0.465 m from its axis,
      // plus the cap's 0.02 m overlap toward the stair.
      if (Math.abs(centreOffset + side * 0.555) < 1e-5 && normal.dot(across) * -side > 0.99999) {
        const heights = vertices.map((p) => p.z)
        assert.ok(Math.max(...heights) - Math.min(...heights) > 3, 'stair skin spans the full incline')
        stairSkinFaces++
      }
    }
    assert.ok(longFaces >= 8, 'both the vertical cheek and shelf follow the incline')
    assert.equal(stairSkinFaces, 2, 'continuous outward-facing metal seals the stair side beneath the shelf')
    for (const dome of domes) {
      assertDomeSeated(dome, mesh, new THREE.Vector3(-axis.x * 5 / 8, -axis.y * 5 / 8, 1).normalize())
    }
  }
})

test('a bank fills its seam at every run length, and only between pieces of one length', () => {
  for (const spec of RAMP_LENGTHS) {
    // Escalator beside escalator, and a 单跑楼梯 beside an escalator: one cap either way,
    // because a seam is a property of two runs of the same length standing flush.
    assert.equal(joins([escalator(0, 'a', 0, 1, 'up', 0, 0, spec.id), escalator(1, 'b', 0, 1, 'down', 0, 0, spec.id)]).length, 1, `${spec.id} escalator pair`)
    const [paired, pairedStair] = escalatorPairedWithStair(0, 'a', 0, 'up', 0, 0, spec.id, 1)
    assert.equal(joins([paired, pairedStair]).length, 1, `${spec.id} stair beside an escalator`)
  }
  // Two lengths are two runs: their landings, slopes and rail returns do not meet,
  // so nothing is drawn across the step between them.
  const [first, ...rest] = RAMP_LENGTHS
  for (const other of rest) {
    assert.equal(joins([escalator(0, 'a', 0, 1, 'up', 0, 0, first.id), escalator(1, 'b', 0, 1, 'down', 0, 0, other.id)]).length, 0, `${first.id} vs ${other.id}`)
  }
  // Each length's own cap still follows its incline between the rail returns.
  for (const spec of RAMP_LENGTHS) {
    const [{ bounds }] = joins([escalator(0, 'a', 0, 1, 'up', 0, 0, spec.id), escalator(1, 'b', 0, 1, 'down', 0, 0, spec.id)])
    const size = bounds.getSize(new THREE.Vector3())
    assert.ok(size.y > rampLengthSpec(spec.id).run * 0.8, `${spec.id} cap spans the run it fills`)
    assert.ok(Math.abs(size.x - 0.32) < 1e-5, `${spec.id} cap fills the 28 cm gap`)
  }
})

test('staggered, crossing, too-far and differently elevated runs do not grow caps', () => {
  const e = escalator(0, 'e')
  for (const other of [escalator(1, 'stagger', 0, 1, 'up', 1), escalator(1, 'cross', 1), escalator(3, 'far'), escalator(1, 'high', 0, 1, 'up', 0, 4)]) {
    assert.equal(joins([e, other]).length, 0, `${other.id} is not a bridged parallel run`)
  }
  const block = createModule('stair-block', 1, 0, 0, 'block')
  assert.equal(joins([e, block]).length, 0, 'stair blocks have no matching balustrade')
})
