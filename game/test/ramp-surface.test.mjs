// Exact underside/block contact, including the actual rotated equipment meshes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule } from '../src/build/model.ts'
import { EscalatorModel } from '../src/render/models/pieces/EscalatorModel.ts'
import { StairModel } from '../src/render/models/pieces/StairModel.ts'
import { buildSolidSet, meshChunk } from '../src/render/chunkMesher.ts'
import { rampSurfaceHeight, rampSurfaceRegions } from '../src/render/rampSurfaceMesh.ts'
import { rampSlopeCuts } from '../src/sim/openings.ts'
import { escalatorInclineRun } from '../src/sim/escalators.ts'
import { stairFlights } from '../src/sim/stairs.ts'
import { exitLandingHeight } from '../src/sim/exitLanding.ts'
import { ChunkSystem } from '../src/render/scene/systems/ChunkSystem.ts'
import { SceneContextData } from '../src/render/scene/systems/SceneSystem.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { packKey } from '../src/sim/types.ts'

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
const patch = (extra = {}) => ({ axis: 'x', lo: 0, hi: 1, x0: 0, x1: 1, y0: 0, y1: 1, ...extra })
const close = (a, b) => assert.ok(Math.abs(a - b) < 2e-5, `${a} != ${b}`)

test('slope triangles follow the floor, ceiling and base clamp without bridging a bend', () => {
  for (const cut of [{ axis: 'x', lo: -0.5, hi: 1.5 }, { axis: 'y', lo: -0.5, hi: 1.5, base: 0.3 }]) {
    const k = packKey(0, 0, 0)
    const mesh = meshChunk(buildSolidSet([{ x: 0, y: 0, z: 0, fill: 'solid' }]), new Map(), 0, 0, 0, 0, new Set([k]), undefined, undefined, undefined, new Map([[k, cut]]))
    let caps = 0
    for (const part of mesh.parts) for (let t = 0; t < part.indices.length; t += 3) {
      const [i, j, k] = [part.indices[t] * 3, part.indices[t + 1] * 3, part.indices[t + 2] * 3]
      if (part.normals[i + 2] <= 0) continue
      const p = part.positions
      const x = (p[i] + p[j] + p[k]) / 3
      const y = (p[i + 1] + p[j + 1] + p[k + 1]) / 3
      const z = (p[i + 2] + p[j + 2] + p[k + 2]) / 3
      close(z, Math.max(0, Math.min(1, Math.max(cut.base ?? -Infinity, cut.lo + (cut.hi - cut.lo) * (cut.axis === 'x' ? x : y)))))
      caps++
    }
    assert.ok(caps > 4, 'cap is split at its changes in slope')
  }
})

test('partial footprints preserve the rest of a block and crossing planes keep their intersection', () => {
  for (const patches of [
    [patch({ lo: 0.25, hi: 0.25, x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8 })],
    [patch(), patch({ axis: 'y', lo: 1, hi: 0 })],
  ]) {
    const cut = { ...patches[0], patches }
    const regions = rampSurfaceRegions(square, cut)
    let area = 0
    for (const r of regions) {
      const poly = r.polygon
      for (let i = 1; i + 1 < poly.length; i++) {
        const [a, b, c] = [poly[0], poly[i], poly[i + 1]]
        area += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
        const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3
        close((r.height(a.x, a.y) + r.height(b.x, b.y) + r.height(c.x, c.y)) / 3, rampSurfaceHeight(cut, x, y))
      }
    }
    close(area, 1)
    assert.ok(regions.length > 1)
  }
})

test('actual stair soffits and escalator trusses meet the calculated terrain plane', () => {
  const mats = new Proxy({}, { get: (o, k) => o[k] ??= new THREE.MeshStandardMaterial() })
  for (const type of ['escalator', 'stair-straight', 'stair-right180', 'stair-right90']) {
    for (const span of ['single', 'double', 'triple']) for (const raisedExit of [false, true]) for (let rot = 0; rot < 4; rot++) for (const dir of type === 'escalator' ? ['up', 'down'] : ['up']) {
      const mod = createModule(type, -12, -12, -5, 'run', rot, type === 'escalator' ? 3 : 2.04, dir, 'lane', [], undefined, { escalatorSpan: span })
      assert.equal(Math.abs(mod.to.z - mod.from.z), span === 'triple' ? 15 : span === 'double' ? 10 : 5)
      const upper = mod.from.z > mod.to.z ? mod.from : mod.to
      const exit = createModule('exit-covered-1', upper.x, upper.y, upper.z, 'exit', 0)
      const modules = raisedExit ? [mod, exit] : [mod]
      if (raisedExit) assert.equal(exitLandingHeight(modules, upper), 0.25)
      const ctx = { mats, finish: () => mats.concrete, data: { name: 'contact', seed: 1, cells: [], modules, lines: [] }, preview: false }
      const group = type === 'escalator' ? new EscalatorModel(ctx).build(mod) : new StairModel(ctx).build(mod)
      group.updateMatrixWorld(true)
      const surfaces = []
      group.traverse(o => { if (o.name === (type === 'escalator' ? 'truss' : 'stair-soffit')) surfaces.push(o) })
      const cuts = rampSlopeCuts(modules)
      const flights = type === 'escalator' ? [escalatorInclineRun(mod)] : stairFlights(mod)
      assert.equal(surfaces.length, flights.length)
      for (const surface of surfaces) {
        const centre = new THREE.Box3().setFromObject(surface).getCenter(new THREE.Vector3())
        const ray = new THREE.Raycaster(new THREE.Vector3(centre.x + 0.071, centre.y + 0.053, -100), new THREE.Vector3(0, 0, 1))
        const hit = ray.intersectObject(surface)[0]
        assert.ok(hit, `${type}/${rot}/${dir}: underside ray missed`)
        const { x, y, z } = hit.point
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
        const cut = cuts.get(packKey(ix, iy, iz))
        assert.ok(cut, `${type}/${rot}/${dir}: no terrain cut at ${x},${y},${z}`)
        close(iz + rampSurfaceHeight(cut, x - ix, y - iy), z)
      }
      group.traverse(o => { if (o.geometry) o.geometry.dispose() })
    }
  }
  for (const m of Object.values(mats)) m.dispose()
})

test('a cut neighbour exposes only the upper part of the adjoining block wall', () => {
  const solid = buildSolidSet([{ x: 0, y: 0, z: 0, fill: 'solid' }, { x: 1, y: 0, z: 0, fill: 'solid' }])
  const mesh = meshChunk(solid, new Map(), 0, 0, 0, 0, new Set([packKey(0, 0, 0)]), undefined, undefined, undefined, new Map([[packKey(1, 0, 0), { axis: 'y', lo: 0.2, hi: 0.8 }]]))
  let count = 0
  for (const part of mesh.parts) for (let i = 0; i < part.positions.length; i += 3) {
    if (part.normals[i] < 0.9) continue
    close(part.positions[i], 1)
    assert.ok(part.positions[i + 2] >= 0.2 + 0.6 * part.positions[i + 1] - 2e-5)
    count++
  }
  assert.ok(count > 0, 'block side was incorrectly culled against a shaved neighbour')
})

test('a shaved half wall keeps its exposed inner face', () => {
  const k = packKey(0, 0, 0)
  const solid = buildSolidSet([{ x: 0, y: 0, z: 0, fill: 'solid' }])
  const mesh = meshChunk(solid, new Map(), 0, 0, 0, 0, new Set([k]), undefined, undefined,
    new Map([[k, { kind: 'half', side: 'w' }]]), new Map([[k, { axis: 'y', lo: 0.3, hi: 0.7 }]]))
  assert.ok(mesh.parts.some(part => Array.from(part.normals).some((n, i) => i % 3 === 0 && n > 0.9)), 'inner wall disappeared after shaving')
})

test('footprint-only changes invalidate the cut chunk and its neighbour across a chunk seam', () => {
  const material = new THREE.MeshBasicMaterial()
  const make = () => new ChunkSystem(new SceneContextData(new THREE.Scene(), { finish: () => material, outline: material }, {}, {}))
  const incremental = make(), fresh = make()
  const cells = [15, 16].map(x => ({ x, y: 0, z: 1, fill: 'solid' }))
  const data = { ...emptyStation(), cells, modules: [] }
  const install = (chunks, y1) => {
    chunks.prepareStation(data, cells)
    chunks.ctx.slopeCuts = new Map([[packKey(16, 0, 1), { axis: 'x', lo: 0.4, hi: 0.4, patches: [patch({ lo: 0.4, hi: 0.4, y1 })] }]])
    chunks.meshStation()
  }
  const snapshot = chunks => chunks.chunkMeshes.map(m => JSON.stringify(Array.from(m.geometry.attributes.position.array))).sort()
  try {
    install(incremental, 1)
    const before = snapshot(incremental)
    install(incremental, 0.6)
    install(fresh, 0.6)
    assert.notDeepEqual(snapshot(incremental), before, 'new footprint reused old surfaces')
    assert.deepEqual(snapshot(incremental), snapshot(fresh), 'chunk halo reused a stale wall beside the changed cut')
  } finally { incremental.disposeChunks(); fresh.disposeChunks(); material.dispose() }
})
