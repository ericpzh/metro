import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'

// The structure family: the generated station shell, not a palette module.
// Every asset is a representative *parameter case* built from a synthetic
// station document in Node and meshed by the game's own generators:
//
//   structure-floor     chunkMesher: a 6 x 4 m floor slab with a 2 x 2 stair opening
//   structure-wall      chunkMesher: a 6 x 4 m wall with a 2 m door and a 1 m window
//   structure-ceiling   chunkMesher: a 6 x 4 m ceiling slab with a 2 x 2 cutaway
//   structure-finishes  chunkMesher: adjacent top faces painted across a finish seam
//   ramp-surface        chunkMesher + rampSurfaceMesh: ground cut to a 30 degree run
//   ramp-join           RampJoinModel: the stainless infill between two flush runs
//
// Two behaviours live only in the renderer's runtime: the face-finish re-mesh
// (the chunk cache is invalidated by the paint) and the ceiling cutaway
// recomputation. Both are exercised here through the real TypeScript code and
// their exact input/expected-output case is written into the manifest; the
// Unity side proves the snapshot, so those rows are reported PARTIAL.
//
// No canvas textures: the review materials are authored from the finish table
// (tint + look), named deterministically, and the GLBs stay a few kilobytes.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
Math.random = seeded(0x5eed1234)

// GLTFExporter reads binary buffers back through FileReader. No DOM/canvas shim
// is needed: this family authors its materials from the finish table.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const gameRequire = createRequire(new URL('../../game/package.json', import.meta.url))
const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { GLTFExporter } = await import(pathToFileURL(gameRequire.resolve('three/addons/exporters/GLTFExporter.js')).href)
const { mergeGeometries } = await import(pathToFileURL(gameRequire.resolve('three/addons/utils/BufferGeometryUtils.js')).href)
const { buildSolidSet, meshChunk } = await import('../../game/src/render/chunkMesher.ts')
const { finishDef, finishMapOf } = await import('../../game/src/sim/finishes.ts')
const { packKey } = await import('../../game/src/sim/types.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { rampSlopeCuts } = await import('../../game/src/sim/openings.ts')
const { rampSurfaceRegions, rampSurfaceHeight } = await import('../../game/src/render/rampSurfaceMesh.ts')
const { addRampJoins } = await import('../../game/src/render/models/pieces/RampJoinModel.ts')
const { ChunkSystem } = await import('../../game/src/render/scene/systems/ChunkSystem.ts')
const { SceneContextData } = await import('../../game/src/render/scene/systems/SceneSystem.ts')
const { emptyStation } = await import('../../game/src/data/reference-station.ts')

/* --------------------------------------------------------------- materials */

// Roughness / metalness per procedural look, so a review surface reads as the
// material family it belongs to (granite vs. plaster vs. steel). No maps.
const LOOK = {
  granite: [0.55, 0.0], concrete: [0.92, 0.0], marble: [0.38, 0.02], limestone: [0.8, 0.0],
  sandstone: [0.86, 0.0], slate: [0.7, 0.04], obsidian: [0.32, 0.08], softwood: [0.78, 0.0],
  hardwood: [0.58, 0.0], tile: [0.42, 0.04], track: [0.9, 0.05], soil: [1.0, 0.0],
  baffle: [0.7, 0.2], metal: [0.48, 0.55], steel: [0.4, 0.7], plaster: [0.9, 0.0],
  enamel: [0.34, 0.08], stainless: [0.3, 0.82],
}
const materials = new Map()
/** Deterministic material name for a finish id: `finish_floor_concrete`. */
function finishMaterialName(id) {
  return 'finish_' + id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
function finishMaterial(id) {
  let material = materials.get(id)
  if (material) return material
  const def = finishDef(id)
  const [roughness, metalness] = LOOK[def.look] ?? [0.8, 0]
  material = new THREE.MeshStandardMaterial({ color: def.tint, roughness, metalness })
  material.name = finishMaterialName(id)
  material.userData = {}
  materials.set(id, material)
  return material
}

/* -------------------------------------------------------------- case input */

const ALL_FACES = id => ({ top: id, bottom: id, n: id, e: id, s: id, w: id })
const solid = (x, y, z, finish) => ({ x, y, z, fill: 'solid', ...(finish ? { finish } : {}) })

/** Mesh a synthetic document through the game's own chunk mesher. */
function meshCells(cells, modules = [], cuts, fills) {
  assert.ok(cells.length > 0, 'a case needs cells')
  const keys = new Set(cells.map(c => packKey(c.x, c.y, c.z)))
  const visits = cells.map(({ x, y, z }) => ({ x, y, z }))
  const zEnd = Math.max(...cells.map(c => c.z))
  return meshChunk(buildSolidSet(cells), finishMapOf(cells), 0, 0, 0, zEnd, keys, undefined, visits, undefined, cuts, fills)
}

/** Put one mesh per finish part into a Z-up source group, named from the finish. */
function meshParts(parts, prefab) {
  const root = new THREE.Group()
  root.name = prefab
  for (const part of parts) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3))
    geometry.setIndex(new THREE.BufferAttribute(part.indices, 1))
    const mesh = new THREE.Mesh(geometry, finishMaterial(part.finish))
    mesh.name = `Finish_${part.finish.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
    root.add(mesh)
  }
  return root
}

/* ------------------------------------------------------------------- floor */

function floorCase() {
  const cells = []
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 4; y++) {
      if (x >= 2 && x <= 3 && y >= 1 && y <= 2) continue // the stair/opening hole
      cells.push(solid(x, y, 0, { top: 'floor.granite' }))
    }
  }
  assert.equal(cells.length, 20)
  const chunk = meshCells(cells)
  const root = meshParts(chunk.parts, 'StructureFloor')
  return {
    id: 'structure-floor', prefab: 'StructureFloor', file: 'structure-floor.glb',
    caseName: 'floor-slab-with-stair-opening',
    source: 'game/src/render/chunkMesher.ts',
    provenance: 'Procedural block floor slab meshed by the repository chunk mesher; synthetic 6 x 4 m document with a 2 x 2 m opening',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'Origin', position: [0, 0, 0] },
      { name: 'SlabTop', position: [0, 0, 1] },
      { name: 'OpeningCentre', position: [3, 2, 1] },
      { name: 'Up', position: [0, 0, 2] },
    ],
    caseParameters: {
      widthMetres: 6, depthMetres: 4, heightMetres: 1,
      solidCells: cells.length, openingCells: 4,
      openingWidthMetres: 2, openingDepthMetres: 2,
      topFinish: 'floor.granite', sideFinish: 'floor.concrete',
    },
  }
}

/* -------------------------------------------------------------------- wall */

function wallCase() {
  const cells = []
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 4; z++) {
      if (x >= 1 && x <= 2 && z <= 1) continue // 2 m door
      if (x === 4 && z === 2) continue // 1 m window
      cells.push(solid(x, 0, z, ALL_FACES('wall.plaster')))
    }
  }
  assert.equal(cells.length, 19)
  const chunk = meshCells(cells)
  const root = meshParts(chunk.parts, 'StructureWall')
  return {
    id: 'structure-wall', prefab: 'StructureWall', file: 'structure-wall.glb',
    caseName: 'wall-with-door-and-window',
    source: 'game/src/render/chunkMesher.ts',
    provenance: 'Procedural block wall meshed by the repository chunk mesher; synthetic 6 x 4 m panel with a 2 x 2 m door and a 1 x 1 m window',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'Origin', position: [0, 0, 0] },
      { name: 'DoorCentre', position: [2, 0.5, 1] },
      { name: 'WindowCentre', position: [4.5, 0.5, 2.5] },
      { name: 'WallTop', position: [0, 0.5, 4] },
    ],
    caseParameters: {
      widthMetres: 6, depthMetres: 1, heightMetres: 4,
      solidCells: cells.length, doorCells: 4, windowCells: 1,
      doorWidthMetres: 2, doorHeightMetres: 2, windowWidthMetres: 1,
      finish: 'wall.plaster',
    },
  }
}

/* ----------------------------------------------------------------- ceiling */

function ceilingCase() {
  const finish = { top: 'floor.concrete', bottom: 'ceil.metal', n: 'ceil.metal', e: 'ceil.metal', s: 'ceil.metal', w: 'ceil.metal' }
  const cells = []
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 4; y++) {
      if (x >= 2 && x <= 3 && y >= 1 && y <= 2) continue // the cutaway
      cells.push(solid(x, y, 4, finish))
    }
  }
  assert.equal(cells.length, 20)
  const chunk = meshCells(cells)
  const root = meshParts(chunk.parts, 'StructureCeiling')
  return {
    id: 'structure-ceiling', prefab: 'StructureCeiling', file: 'structure-ceiling.glb',
    caseName: 'ceiling-slab-with-cutaway',
    source: 'game/src/render/chunkMesher.ts',
    provenance: 'Procedural block ceiling slab meshed by the repository chunk mesher; synthetic 6 x 4 m slab at z=4 with a 2 x 2 m cutaway',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'Origin', position: [0, 0, 4] },
      { name: 'CeilingTop', position: [0, 0, 5] },
      { name: 'CutawayCentre', position: [3, 2, 4] },
    ],
    caseParameters: {
      widthMetres: 6, depthMetres: 4, heightMetres: 1,
      solidCells: cells.length, cutawayCells: 4,
      cutawayWidthMetres: 2, cutawayDepthMetres: 2,
      topFinish: 'floor.concrete', bottomFinish: 'ceil.metal',
      sourceZ: 4,
    },
  }
}

/* ---------------------------------------------------------------- finishes */

function finishesCase() {
  // Three adjacent finish regions on one slab; the middle column is the face
  // whose paint changes between the before/after runtime document.
  const topFinishes = ['floor.granite', 'wall.enamel', 'floor.concrete', 'floor.concrete']
  const cells = []
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) cells.push(solid(x, y, 0, { top: topFinishes[x] }))
  const chunk = meshCells(cells)
  const root = meshParts(chunk.parts, 'StructureFinishes')
  return {
    id: 'structure-finishes', prefab: 'StructureFinishes', file: 'structure-finishes.glb',
    caseName: 'adjacent-faces-with-finish-change',
    source: 'game/src/render/chunkMesher.ts; game/src/render/scene/systems/ChunkSystem.ts',
    provenance: 'Procedural block slab meshed by the repository chunk mesher; synthetic 4 x 2 m document with three face finishes and a painted column',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'Origin', position: [0, 0, 0] },
      { name: 'FinishSeam', position: [1, 1, 1] },
      { name: 'PaintedFace', position: [1.5, 1, 1] },
      { name: 'SlabTop', position: [0, 0, 1] },
    ],
    caseParameters: {
      widthMetres: 4, depthMetres: 2, heightMetres: 1,
      solidCells: cells.length, finishCount: 3, changedCells: 2,
      changedFinish: 'wall.enamel', beforeFinish: 'floor.granite',
      finishes: topFinishes,
    },
  }
}

/* ------------------------------------------------------------ ramp surface */

function rampSurfaceCase() {
  const module = createModule('escalator', 0, 0, 0, 'ramp-surface-run', 1, 1, 'up', 'lane', [], undefined, { rampLength: 'long' })
  assert.ok(module, 'createModule returned no escalator')
  assert.deepEqual([module.from, module.to], [{ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 5 }])
  const cuts = rampSlopeCuts([module])
  assert.ok(cuts.size > 0, 'the 30-degree run cut no ground')

  // Build the solid mass under the run's underside: every cut cell plus the
  // blocks below it. The cut caps then form one continuous sloped surface.
  const cells = []
  const seen = new Set()
  const add = cell => { const k = packKey(cell.x, cell.y, cell.z); if (!seen.has(k)) { seen.add(k); cells.push(cell) } }
  for (const key of cuts.keys()) {
    let found
    for (let x = 0; x <= 9 && !found; x++) for (let y = 0; y <= 1 && !found; y++) for (let z = 0; z <= 7 && !found; z++) {
      if (packKey(x, y, z) === key) found = { x, y, z }
    }
    assert.ok(found, 'cut key outside the run bounds')
    for (let z = 0; z <= found.z; z++) add(solid(found.x, found.y, z, z === found.z ? { top: 'floor.granite' } : undefined))
  }
  const chunk = meshCells(cells, [module], cuts)
  const root = meshParts(chunk.parts, 'RampSurface')

  // The cap heights on consecutive cells: the slope the region splitter produces.
  const heights = []
  for (let x = 0; x <= 8; x++) {
    let best
    for (const [key, cut] of cuts) {
      const cell = unpack(key)
      if (cell.x !== x || cell.y !== 0) continue
      const height = cell.z + rampSurfaceHeight(cut, 1, 0.5)
      if (best === undefined || height > best) best = height
    }
    if (best !== undefined) heights.push([x + 1, Number(best.toFixed(4))])
  }
  assert.ok(heights.length >= 5, `expected a slope across the run, got ${heights.length} cuts`)
  const first = heights[0], last = heights.at(-1)
  const capGrade = Math.atan2(last[1] - first[1], last[0] - first[0]) * 180 / Math.PI

  // Region derivation: one polygon per cut cell, area exactly one square.
  let regions = 0
  let area = 0
  for (const cut of cuts.values()) {
    for (const region of rampSurfaceRegions([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], cut)) {
      regions++
      const p = region.polygon
      for (let i = 1; i + 1 < p.length; i++) {
        area += Math.abs((p[i].x - p[0].x) * (p[i + 1].y - p[0].y) - (p[i].y - p[0].y) * (p[i + 1].x - p[0].x)) / 2
      }
    }
  }
  assert.ok(Math.abs(area - cuts.size) < 1e-6, 'the cut regions do not tile every cell exactly once')

  const rise = module.to.z - module.from.z
  const run = Math.hypot(module.to.x - module.from.x, module.to.y - module.from.y)
  return {
    id: 'ramp-surface', prefab: 'RampSurface', file: 'ramp-surface.glb',
    caseName: 'sloped-ground-under-30-degree-run',
    source: 'game/src/render/rampSurfaceMesh.ts; game/src/render/chunkMesher.ts; game/src/sim/openings.ts',
    provenance: 'Procedural ground cut under a synthetic 30 degree escalator run, split into planar regions by the repository ramp surface splitter and meshed by the chunk mesher',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'Foot', position: [0.5, 0.5, 1] },
      { name: 'Head', position: [9.5, 0.5, 6] },
      { name: 'SlopeMid', position: [5, 0.5, 3.5] },
    ],
    caseParameters: {
      widthMetres: 9, depthMetres: 1, heightMetres: 6,
      solidCells: cells.length, cutCells: cuts.size, regions, regionArea: Number(area.toFixed(6)),
      runLengthMetres: run, riseMetres: rise,
      gradeDegrees: Number((Math.atan2(rise, run) * 180 / Math.PI).toFixed(3)),
      capGradeDegrees: Number(capGrade.toFixed(3)),
      inclineDegrees: 30, moduleFrom: module.from, moduleTo: module.to,
      cutHeights: heights.map(([x, z]) => [x, Number(z.toFixed(4))]),
    },
  }
}

/** Inverse of the mesher's packed key, for the synthetic ramp scan. */
function unpack(key) {
  const OFF = 4096, SPAN = 8192
  const z = (key % SPAN) - OFF
  const rest = (key - (z + OFF)) / SPAN
  const y = (rest % SPAN) - OFF
  const x = (rest - (y + OFF)) / SPAN - OFF
  return { x, y, z }
}

/* --------------------------------------------------------------- ramp join */

function rampJoinCase() {
  const a = createModule('escalator', 0, 0, 0, 'join-a', 1, 1, 'up', 'lane', [], undefined, { rampLength: 'long' })
  const b = createModule('escalator', 0, 1, 0, 'join-b', 1, 1, 'up', 'lane', [], undefined, { rampLength: 'long' })
  assert.ok(a && b, 'createModule returned no escalator pair')
  const steel = finishMaterial('wall.stainless')
  const ctx = {
    data: { name: 'ramp-join', cells: [], modules: [a, b], lines: [] },
    mats: { steel, glass: finishMaterial('wall.stainless') },
    preview: false,
  }
  const built = new THREE.Group()
  built.name = 'RampJoinSource'
  addRampJoins(ctx, a, built)
  const boards = built.children.filter(child => child.name === 'ramp-join')
  const domes = built.children.filter(child => child.name === 'ramp-join-dome')
  assert.equal(boards.length, 1, 'a flush escalator pair draws one seam')
  assert.ok(domes.length >= 1, 'the seam has no seated domes')

  const root = new THREE.Group()
  root.name = 'RampJoin'
  const board = boards[0]
  board.geometry.deleteAttribute('uv')
  const boardMesh = new THREE.Mesh(board.geometry.clone(), steel)
  boardMesh.name = 'Finish_ramp_join_infill'
  root.add(boardMesh)
  const merged = mergeGeometries(domes.map(dome => dome.geometry.clone()), false)
  assert.ok(merged, 'could not merge the seam domes')
  merged.deleteAttribute('uv')
  const domeMesh = new THREE.Mesh(merged, steel)
  domeMesh.name = 'Finish_ramp_join_domes'
  root.add(domeMesh)

  const position = board.geometry.getAttribute('position')
  let lower = null, upper = null
  for (let i = 0; i < position.count; i++) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)]
    if (!lower || p[2] < lower[2]) lower = p
    if (!upper || p[2] > upper[2]) upper = p
  }
  const mid = [(lower[0] + upper[0]) / 2, (lower[1] + upper[1]) / 2, (lower[2] + upper[2]) / 2]
  const run = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y)
  return {
    id: 'ramp-join', prefab: 'RampJoin', file: 'ramp-join.glb',
    caseName: 'flush-escalator-pair-seam',
    source: 'game/src/render/models/pieces/RampJoinModel.ts',
    provenance: 'Stainless infill and seated domes generated by the repository RampJoinModel for two flush 30 degree runs one block apart',
    licenseRecord: 'Repository-authored procedural geometry; no third-party assets',
    root,
    anchors: [
      { name: 'LowerEnd', position: lower.map(n => Number(n.toFixed(4))) },
      { name: 'UpperEnd', position: upper.map(n => Number(n.toFixed(4))) },
      { name: 'SeamCentre', position: mid.map(n => Number(n.toFixed(4))) },
    ],
    caseParameters: {
      widthMetres: Number((Math.abs(lower[1] - upper[1]) + 0.32).toFixed(3)),
      depthMetres: 2, heightMetres: Number((upper[2] - lower[2]).toFixed(3)),
      modules: 2, runs: 2, seamCount: 1, domeCount: domes.length,
      spacingMetres: 1, runLengthMetres: run, riseMetres: a.to.z - a.from.z,
      gradeDegrees: Number((Math.atan2(a.to.z - a.from.z, run) * 180 / Math.PI).toFixed(3)),
      capWidthMetres: 0.32, material: 'wall.stainless',
    },
  }
}

/* ------------------------------------------------------- runtime-only cases */

const signature = system => system.chunkMeshes
  .map(mesh => `${mesh.material.name}|${JSON.stringify(Array.from(mesh.geometry.attributes.position.array))}|${JSON.stringify(Array.from(mesh.geometry.index?.array ?? []))}`)
  .sort()

const chunkOf = mesh => {
  mesh.geometry.computeBoundingBox()
  return Math.floor(mesh.geometry.boundingBox.min.x / 16)
}

function makeChunkSystem(cells) {
  const material = id => finishMaterial(id)
  const system = new ChunkSystem(new SceneContextData(new THREE.Scene(), { finish: material, outline: material }, {}, {}))
  system.prepareStation({ ...emptyStation(), cells, modules: [] }, cells)
  system.meshStation()
  return system
}

/**
 * The dirty-neighbour finish case: a paint on the cell across a chunk seam.
 * The chunk holding the painted face must re-mesh into the new finish part; the
 * neighbouring chunk must keep its cached meshes; and the incremental result
 * must equal a fresh full mesh of the after document.
 */
function finishesRuntime() {
  const before = [
    solid(15, 0, 0, { top: 'floor.granite' }),
    solid(16, 0, 0, { top: 'floor.granite' }),
  ]
  const after = [before[0], solid(16, 0, 0, { top: 'wall.enamel' })]
  const live = makeChunkSystem(before)
  const oldMeshes = new Set(live.chunkMeshes)
  const beforeSig = signature(live)
  const beforeMaterials = [...new Set(live.chunkMeshes.filter(m => chunkOf(m) === 0).map(m => m.material.name))].sort()
  const beforePainted = [...new Set(live.chunkMeshes.filter(m => chunkOf(m) === 1).map(m => m.material.name))].sort()
  live.prepareStation({ ...emptyStation(), cells: after, modules: [] }, after)
  live.meshStation()
  const afterSig = signature(live)
  const reused = live.chunkMeshes.filter(m => oldMeshes.has(m)).length
  const afterPainted = [...new Set(live.chunkMeshes.filter(m => chunkOf(m) === 1).map(m => m.material.name))].sort()
  const fresh = makeChunkSystem(after)
  const freshSig = signature(fresh)
  live.disposeChunks?.()
  fresh.disposeChunks?.()
  assert.notDeepEqual(afterSig, beforeSig, 'the painted chunk reused its stale finish parts')
  assert.deepEqual(afterSig, freshSig, 'the incremental finish re-mesh differs from a fresh build')
  assert.deepEqual(beforeMaterials, ['finish_floor_concrete', 'finish_floor_granite'])
  assert.deepEqual(beforePainted, ['finish_floor_concrete', 'finish_floor_granite'])
  assert.deepEqual(afterPainted, ['finish_floor_concrete', 'finish_wall_enamel'])
  return {
    row: 'structure-finishes',
    input: `before cells ${JSON.stringify(before)}; after cells ${JSON.stringify(after)}`,
    expected: 'chunk 1 (x=16) re-meshes from {floor.granite + floor.concrete} to {wall.enamel + floor.concrete}; chunk 0 (x=15) keeps its cached meshes; incremental result equals a fresh build',
    actual: `chunk0 materials ${beforeMaterials.join('+')} (unchanged, ${reused} cached meshes reused); chunk1 before ${beforePainted.join('+')} -> after ${afterPainted.join('+')}; incremental signature equals fresh build; mesh count ${beforeSig.length} -> ${afterSig.length}`,
  }
}

/** The cutaway recomputation: removing the ceiling cells re-meshes the hole and its edges. */
function ceilingRuntime() {
  const finish = { top: 'floor.concrete', bottom: 'ceil.metal', n: 'ceil.metal', e: 'ceil.metal', s: 'ceil.metal', w: 'ceil.metal' }
  const cells = []
  for (let x = 0; x < 6; x++) for (let y = 0; y < 4; y++) cells.push(solid(x, y, 4, finish))
  const full = meshCells(cells)
  const cut = cells.filter(c => !(c.x >= 2 && c.x <= 3 && c.y >= 1 && c.y <= 2))
  const opened = meshCells(cut)
  assert.ok(full.triangles > opened.triangles, 'the cutaway did not remove any geometry')
  const fullTop = full.parts.find(p => p.finish === 'floor.concrete')?.triangles ?? 0
  const openTop = opened.parts.find(p => p.finish === 'floor.concrete')?.triangles ?? 0
  const fullBottom = full.parts.find(p => p.finish === 'ceil.metal')?.triangles ?? 0
  const openBottom = opened.parts.find(p => p.finish === 'ceil.metal')?.triangles ?? 0
  assert.ok(openTop < fullTop, 'the cutaway top did not shrink')
  assert.ok(opened.triangles !== full.triangles, 'the cutaway did not change the mesh')
  return {
    row: 'structure-ceiling',
    input: `6 x 4 ceiling slab at z=4, ${cells.length} solid cells; cutaway removes the 2 x 2 cells x=2..3, y=1..2 (${cells.length - cut.length} cells)`,
    expected: 'the re-meshed slab loses the removed top faces and gains the opening edge faces; a renderer that only hides the whole ceiling cannot show the hole',
    actual: `triangles ${full.triangles} -> ${opened.triangles}; top part ${fullTop} -> ${openTop}; metal part (underside + opening edges) ${fullBottom} -> ${openBottom}; parts ${full.parts.length} -> ${opened.parts.length}`,
  }
}

/* ------------------------------------------------------------ layout + GLB */

function assemble(asset) {
  // Recentre the document geometry: plan-centred, sitting on z = 0. The 180
  // degree Unity-basis wrapper then leaves bounds and anchors where the
  // manifest records them.
  const box = new THREE.Box3()
  asset.root.updateMatrixWorld(true)
  asset.root.traverse(object => {
    if (!object.isMesh) return
    object.geometry.computeBoundingBox()
    box.union(object.geometry.boundingBox)
  })
  const offset = new THREE.Vector3(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -box.min.z,
  )
  asset.root.traverse(object => { if (object.isMesh) object.geometry.translate(offset.x, offset.y, offset.z) })
  asset.anchors = asset.anchors.map(anchor => ({
    name: anchor.name,
    position: [
      Number((anchor.position[0] + offset.x).toFixed(4)),
      Number((anchor.position[1] + offset.y).toFixed(4)),
      Number((anchor.position[2] + offset.z).toFixed(4)),
    ],
  }))
  // The anchors are real empty nodes in the GLB, so the Unity wrapper verifies
  // them exactly as it verifies the shelf and bin basis anchors.
  for (const anchor of asset.anchors) {
    const object = new THREE.Object3D()
    object.name = anchor.name
    object.position.fromArray(anchor.position)
    asset.root.add(object)
  }
  const bounds = box.clone().translate(offset)
  asset.originOffset = offset.toArray().map(n => Number(n.toFixed(4)))
  asset.min = bounds.min.toArray()
  asset.max = bounds.max.toArray()
  asset.size = bounds.getSize(new THREE.Vector3()).toArray()

  let triangles = 0
  let meshes = 0
  const regions = []
  asset.root.traverse(object => {
    object.userData = {}
    if (!object.isMesh) return
    meshes++
    const geometry = object.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    let area = 0
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i
      const ib = index ? index.getX(i + 1) : i + 1
      const ic = index ? index.getX(i + 2) : i + 2
      a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic)
      area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
    }
    geometry.computeBoundingBox()
    const partTriangles = count / 3
    triangles += partTriangles
    regions.push({
      finish: object.userData.finish ?? finishIdOfMaterial(object.material.name),
      material: object.material.name,
      mesh: object.name,
      triangles: partTriangles,
      area: Number(area.toFixed(6)),
      min: geometry.boundingBox.min.toArray().map(n => Number(n.toFixed(4))),
      max: geometry.boundingBox.max.toArray().map(n => Number(n.toFixed(4))),
    })
  })
  assert.ok(triangles > 0 && meshes > 0, `${asset.id}: no geometry`)
  asset.triangles = triangles
  asset.meshes = meshes
  asset.materials = [...new Set(regions.map(region => region.material))].sort()
  asset.regions = regions

  asset.gltfRoot = new THREE.Group()
  asset.gltfRoot.name = asset.prefab
  asset.gltfRoot.rotation.x = -Math.PI / 2
  asset.gltfRoot.add(asset.root)
  asset.gltfRoot.updateMatrixWorld(true)
  return asset
}

/** The finish id a generated material name stands for, for the manifest. */
function finishIdOfMaterial(name) {
  const found = [...materials.entries()].find(([, material]) => material.name === name)
  return found ? found[0] : name
}

const cases = [
  assemble(floorCase()),
  assemble(wallCase()),
  assemble(ceilingCase()),
  assemble(finishesCase()),
  assemble(rampSurfaceCase()),
  assemble(rampJoinCase()),
]

/* Compact two-row review table: the three storey pieces in front, the ceiling,
 * ramp surface and seam behind. Camera numbers are written to the manifest so
 * the Unity scene and the Web check share one framing. */
const layout = {
  gap: 2.5,
  rowGap: 9,
  frontZ: -2,
  backZ: 7,
  fieldOfView: 42,
  ceilingLift: 3.3,
  cameraDistance: 33,
  cameraPitchDegrees: 28,
  cameraYawMetres: 3,
  targetY: 1.8,
  targetZ: 2.5,
}
const rows = [
  ['structure-floor', 'structure-wall', 'structure-finishes'],
  ['structure-ceiling', 'ramp-surface', 'ramp-join'],
]
const byId = new Map(cases.map(asset => [asset.id, asset]))
const columnWidths = [0, 1, 2].map(column => Math.max(...rows.map(row => byId.get(row[column]).size[0])))
let cursor = 0
const columnX = columnWidths.map(width => { const centre = cursor + width / 2; cursor += width + layout.gap; return centre })
const totalWidth = cursor - layout.gap
for (const [row, ids] of rows.entries()) {
  for (const [column, id] of ids.entries()) {
    const asset = byId.get(id)
    asset.layoutX = Number((columnX[column] - totalWidth / 2).toFixed(4))
    asset.layoutZ = row === 0 ? layout.frontZ : layout.backZ
    asset.layoutY = id === 'structure-ceiling' ? layout.ceilingLift : 0
    asset.layoutYaw = 0
  }
}
const maxHeight = Math.max(...cases.map(asset => asset.layoutY + asset.size[2]))
const maxDepth = Math.max(...cases.map(asset => asset.size[1]))
const tanV = Math.tan(layout.fieldOfView * Math.PI / 360)
layout.rowWidth = Number(totalWidth.toFixed(4))
layout.cameraFieldOfView = layout.fieldOfView
layout.cameraTargetX = 0
layout.cameraTargetY = layout.targetY
layout.cameraTargetZ = layout.targetZ
layout.cameraX = Number((-layout.cameraYawMetres).toFixed(4))
layout.cameraY = Number((layout.targetY + layout.cameraDistance * Math.tan(layout.cameraPitchDegrees * Math.PI / 180)).toFixed(4))
layout.cameraZ = Number((layout.targetZ - layout.cameraDistance).toFixed(4))
layout.maxHeight = Number(maxHeight.toFixed(4))
layout.maxDepth = Number(maxDepth.toFixed(4))

const out = resolve(process.argv[2] ?? '.preview/unity/structure-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const asset of cases) {
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(asset.gltfRoot, { binary: true, onlyVisible: true }))
  const report = await validator.validateBytes(bytes, { uri: asset.file })
  await writeFile(join(out, asset.file.replace(/\.glb$/, '.validation.json')), JSON.stringify(report, null, 2) + '\n')
  assert.equal(
    report.issues.numErrors + report.issues.numWarnings, 0,
    `${asset.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`,
  )
  const manifest = {
    schemaVersion: 1,
    id: asset.id,
    family: 'structure',
    row: asset.id,
    prefab: asset.prefab,
    file: asset.file,
    caseName: asset.caseName,
    source: asset.source,
    provenance: asset.provenance,
    licenseRecord: asset.licenseRecord,
    units: 'metres',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    originOffset: asset.originOffset,
    min: asset.min,
    max: asset.max,
    size: asset.size,
    anchors: asset.anchors,
    triangles: asset.triangles,
    meshes: asset.meshes,
    materials: asset.materials,
    regions: asset.regions,
    layoutX: asset.layoutX,
    layoutY: asset.layoutY,
    layoutZ: asset.layoutZ,
    layoutYaw: asset.layoutYaw,
    caseParameters: asset.caseParameters,
    gradeDegrees: asset.caseParameters.gradeDegrees ?? 0,
    runLengthMetres: asset.caseParameters.runLengthMetres ?? 0,
    riseMetres: asset.caseParameters.riseMetres ?? 0,
    cells: asset.caseParameters.solidCells ?? 0,
    openingCells: asset.caseParameters.openingCells ?? 0,
    doorCells: asset.caseParameters.doorCells ?? 0,
    windowCells: asset.caseParameters.windowCells ?? 0,
    cutawayCells: asset.caseParameters.cutawayCells ?? 0,
    finishCount: asset.caseParameters.finishCount ?? 0,
    seamCount: asset.caseParameters.seamCount ?? 0,
    domeCount: asset.caseParameters.domeCount ?? 0,
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings },
  }
  await writeFile(join(out, asset.file), bytes)
  await writeFile(join(out, asset.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${asset.id}: ${asset.triangles} triangles, ${asset.meshes} meshes, ${asset.materials.length} materials, ${bytes.length} bytes, ${manifest.sha256}`)
}

const runtimeCases = [finishesRuntime(), ceilingRuntime()]
for (const runtime of runtimeCases) console.log(`${runtime.row} runtime: ${runtime.actual}`)

const summary = {
  schemaVersion: 1,
  family: 'structure',
  sourcePaths: [
    'game/src/render/chunkMesher.ts',
    'game/src/render/rampSurfaceMesh.ts',
    'game/src/render/models/pieces/RampJoinModel.ts',
    'game/src/render/scene/systems/ChunkSystem.ts',
    'game/src/sim/openings.ts',
    'game/src/sim/finishes.ts',
    'game/src/sim/escalators.ts',
    'game/src/build/model/Equipment.ts',
  ],
  parameters: {
    stationDocuments: 'Six synthetic station documents built in Node: a 6 x 4 floor slab with a 2 x 2 opening, a 6 x 4 wall with a 2 x 2 door and a 1 x 1 window, a 6 x 4 ceiling slab with a 2 x 2 cutaway, a 4 x 2 finished slab with three face finishes, the ground under a 9-cell 5 m escalator run, and two flush escalator runs for one seam. No palette module and no whole station is exported.',
    conventions: 'Game source space is Z-up; a wrapper group is rotated -90 degrees about X for the glTF Y-up export, and the Unity wrapper applies the 180 degree Y basis correction so gameplay reads (x, z, y). Geometry is plan-centred and sits on source z=0. AO vertex colours and UVs are dropped because the review materials carry no maps; the GLBs are a few kilobytes each.',
    materials: 'Authored from game/src/sim/finishes.ts (tint + procedural look -> roughness/metalness), named finish_<id>; every material name is deterministic and userData is stripped.',
    layout,
    rowOrder: cases.map(asset => asset.id),
    runtimeCases: runtimeCases.length,
  },
  runtimeCases,
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`STRUCTURE_EXPORT_OK ${assets.length} cases, ${runtimeCases.length} runtime cases, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
