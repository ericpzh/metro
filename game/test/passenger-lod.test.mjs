// Crowd detail (§9.3, §7.1). The crowd's Low LoD is a second baked index table
// over the *same* animated pose atlas, drawn by a second prepared instanced mesh.
// Each passenger is packed into the draw its storey asks for — the storey being
// edited full, a ghosted storey reduced — and the level it was classified by is
// recorded per instance. Nothing is rebuilt, no pose data is duplicated, and the
// simulation, identity and picking are untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import human from '../src/assets/passenger-approved.json' with { type: 'json' }
import {
  passengerBody, passengerMesh, passengerMaterial, PASSENGER_HAS_LOW_DETAIL, PASSENGER_LOW_TRIANGLES,
  PASSENGER_FULL_TRIANGLES, passengerAppearance,
} from '../src/render/passengerModel.ts'
import { CrowdSystem } from '../src/render/scene/systems/CrowdSystem.ts'
import { decodePassengerBytes, restorePassengerFrames } from '../src/render/passengerAtlas.ts'
import { passengerLowTopology } from '../../tools/passenger-low-topology.mjs'
import { MeshoptSimplifier } from '../node_modules/meshoptimizer/meshopt_simplifier.js'

const decoded = key => Buffer.from(decodePassengerBytes(human[key], human.encoding))
const triangles = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3

/**
 * Three commuters: two on the storey being edited (z = 0) and one on the storey
 * below (z = -4), so a ghosted floor has a passenger of its own.
 */
function crowdFixture(quality = 'high', toggles = {}) {
  const ctx = { scene: new THREE.Scene(), mats: { blob: new THREE.MeshBasicMaterial() },
    activeZ: 0, levelBase: 0, ghost: false, hideUI: false, stateIntervalMs: 1000, detailEnabled: true, graphicsQuality: quality, ...toggles }
  const crowd = new CrowdSystem(ctx)
  crowd.setAgents(new Float32Array([
    0, 0, 0, 0, 0, 3,
    10, 4, 0, 0, 0, 7,
    20, 0, -4, 0, 0, 11,
  ]), 3, 1000)
  crowd.renderAgents(ctx.lastStateTime + 500)
  return { ctx, crowd }
}

/** The storey each packed instance of a draw recorded, in slot order. */
function levels(mesh) {
  const level = mesh.geometry.getAttribute('passengerLevel')
  return Array.from({ length: mesh.count }, (_, slot) => level.getX(slot))
}

function cleanup({ ctx, crowd }) {
  crowd.dispose()
  ctx.mats.blob.dispose()
}

test('the baked atlas carries a Low topology for every variant, padded the same way', () => {
  assert.equal(PASSENGER_HAS_LOW_DETAIL, true, 'the active atlas was baked with its crowd LoD')
  assert.equal(typeof human.lowCorners, 'number')
  assert.ok(human.lowCorners > 0 && human.lowCorners < human.corners, `${human.lowCorners}/${human.corners} corners`)
  assert.equal(human.lowTriangles, human.lowCorners / 3)
  const raw = decoded('lowIndices')
  const table = human.indexBits === 32 ? new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) : new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
  const fullRaw = decoded('indices')
  const full = human.indexBits === 32 ? new Uint32Array(fullRaw.buffer, fullRaw.byteOffset, fullRaw.byteLength / 4) : new Uint16Array(fullRaw.buffer, fullRaw.byteOffset, fullRaw.byteLength / 2)
  const regions = decoded('regions')
  assert.equal(table.length, human.library.length * human.lowCorners)
  for (const [outfit, model] of human.library.entries()) {
    const source = new Set(full.subarray(outfit * human.corners, outfit * human.corners + model.triangles * 3))
    let real = 0
    for (let i = outfit * human.lowCorners; i < (outfit + 1) * human.lowCorners; i += 3) {
      assert.ok(table[i] < human.vertices && table[i + 1] < human.vertices && table[i + 2] < human.vertices, 'every Low corner reuses a baked vertex')
      for (const v of table.subarray(i, i + 3)) assert.ok(source.has(v), `${model.id}: Low must use this appearance's own animated vertices`)
      assert.equal(regions[table[i]], regions[table[i + 1]], `${model.id}: Low must retain flat palette boundaries`)
      assert.equal(regions[table[i]], regions[table[i + 2]], `${model.id}: Low must retain flat palette boundaries`)
      if (new Set(table.slice(i, i + 3)).size === 3) real++
    }
    assert.equal(real, model.lowTriangles, `${model.id}: shorter variants pad only degenerate triangles`)
    assert.ok(model.lowTriangles > 0 && model.lowTriangles <= Math.floor(model.triangles * .1), `${model.id}: ${model.lowTriangles}/${model.triangles} triangles exceeds 10%`)
  }
  // A shared instanced stride, so the widest Low row is the crowd's floor.
  assert.equal(PASSENGER_LOW_TRIANGLES, Math.max(...human.library.map(model => model.lowTriangles)))
  assert.ok(PASSENGER_LOW_TRIANGLES <= PASSENGER_FULL_TRIANGLES * .1, `Low ${PASSENGER_LOW_TRIANGLES} vs full ${PASSENGER_FULL_TRIANGLES}`)
})

test('every reduced appearance retains its silhouette bounds and ground contact through all three walks', () => {
  const positions = restorePassengerFrames(new Int16Array(decoded('positions').buffer), human.vertices, human.poseEncoding)
  const read = key => { const b = decoded(key); return human.indexBits === 32 ? new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4) : new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) }
  const full = read('indices'), low = read('lowIndices')
  for (const [variant, model] of human.library.entries()) {
    const fullVertices = [...new Set(full.subarray(variant * human.corners, variant * human.corners + model.triangles * 3))]
    const lowVertices = [...new Set(low.subarray(variant * human.lowCorners, variant * human.lowCorners + model.lowTriangles * 3))]
    for (let frame = 0; frame < human.frames; frame++) {
      for (let axis = 0; axis < 3; axis++) {
        const offset = frame * human.vertices * 3 + axis
        const bounds = vertices => {
          let min = Infinity, max = -Infinity
          for (const v of vertices) { const value = positions[offset + v * 3]; min = Math.min(min, value); max = Math.max(max, value) }
          return [min, max]
        }
        assert.deepEqual(bounds(lowVertices), bounds(fullVertices), `${model.id}, frame ${frame}, axis ${axis}: extrema must survive reduction`)
      }
    }
  }
})

test('the offline reducer leaves authoritative poses and topology unchanged and rejects an impossible budget', async () => {
  await MeshoptSimplifier.ready
  const raw = decoded('indices'), full = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const source = [...full.subarray(0, human.library[0].triangles * 3)]
  const poses = restorePassengerFrames(new Int16Array(decoded('positions').buffer), human.vertices, human.poseEncoding)
  const before = poses.slice()
  const regions = decoded('regions')
  const result = passengerLowTopology({ indices: source, poses, regions, vertices: human.vertices })
  assert.ok(result.indices.length > 0 && result.indices.length <= Math.floor(source.length / 30) * 3)
  const clothIndex = human.library.findIndex(m => m.garmentShape === 'skirt'), cloth = human.library[clothIndex]
  const clothSource = [...full.subarray(clothIndex * human.corners, clothIndex * human.corners + cloth.triangles * 3)]
  const clothLow = passengerLowTopology({ indices: clothSource, poses, regions, vertices: human.vertices, garmentShape: cloth.garmentShape, clothRegion: human.paletteRGB.indexOf(cloth.bottom), minimumClothTriangles: 60 })
  assert.ok(clothLow.indices.length > 0 && clothLow.indices.length <= Math.floor(cloth.triangles * .1) * 3)
  assert.deepEqual(source, [...full.subarray(0, source.length)])
  assert.deepEqual(poses, before, 'Low reduction cannot modify High geometry or animation')
  assert.throws(() => passengerLowTopology({ indices: [0, 1, 2], poses: new Int16Array(9), vertices: 3 }), /at least ten/)
  const invalid = Array(10).fill([0, 1, 2]).flat()
  assert.throws(() => passengerLowTopology({ indices: invalid, poses: new Int16Array(9), vertices: 3, regions: [0, 1, 0] }), /crosses palette/)
})

test('reduced bodies keep their projected surfaces, not just isolated extremum triangles', () => {
  const positions = restorePassengerFrames(new Int16Array(decoded('positions').buffer), human.vertices, human.poseEncoding)
  const read = key => { const b = decoded(key); return human.indexBits === 32 ? new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4) : new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2) }
  const full = read('indices'), low = read('lowIndices'), size = 40
  const frames = [0, ...human.walkProfiles.flatMap(p => [0, 6, 12, 18].map(f => p.firstFrame + f))]
  for (const [variant, model] of human.library.entries()) {
    const source = full.subarray(variant * human.corners, variant * human.corners + model.triangles * 3)
    const reduced = low.subarray(variant * human.lowCorners, variant * human.lowCorners + model.lowTriangles * 3)
    const vertices = [...new Set(source)]
    for (const frame of frames) for (const axes of [[0, 2], [1, 2], [0, 1]]) {
      const offset = frame * human.vertices * 3
      const bounds = axes.map(axis => {
        let min = Infinity, max = -Infinity
        for (const v of vertices) { const value = positions[offset + v * 3 + axis]; min = Math.min(min, value); max = Math.max(max, value) }
        return [min - 1, max - min + 2]
      })
      const project = v => axes.map((axis, a) => (positions[offset + v * 3 + axis] - bounds[a][0]) / bounds[a][1] * (size - 2) + 1)
      const raster = indices => {
        const pixels = new Uint8Array(size * size), projected = new Map()
        const point = v => { if (!projected.has(v)) projected.set(v, project(v)); return projected.get(v) }
        for (let i = 0; i < indices.length; i += 3) {
          const [a, b, c] = [point(indices[i]), point(indices[i + 1]), point(indices[i + 2])]
          const cross = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
          if (Math.abs(cross(a, b, c[0], c[1])) < 1e-7) continue
          const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
          const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
          for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
            const e = [cross(a, b, x + .5, y + .5), cross(b, c, x + .5, y + .5), cross(c, a, x + .5, y + .5)]
            if (e.every(v => v >= 0) || e.every(v => v <= 0)) pixels[y * size + x] = 1
          }
        }
        return pixels
      }
      const a = raster(source), b = raster(reduced)
      let fullPixels = 0, overlap = 0
      for (let i = 0; i < a.length; i++) { fullPixels += a[i]; overlap += a[i] && b[i] }
      assert.ok(overlap / fullPixels >= .8, `${model.id}, frame ${frame}, axes ${axes}: only ${(overlap / fullPixels * 100).toFixed(1)}% of the full surface remains`)
    }
  }
})

test('the Low body is a coarser mesh over the same atlas, not a second pose set', () => {
  const full = passengerBody(), low = passengerBody(true)
  try {
    assert.equal(triangles(full), PASSENGER_FULL_TRIANGLES)
    assert.equal(triangles(low), PASSENGER_LOW_TRIANGLES)
    assert.equal(low.getAttribute('passengerVertex').count, human.lowCorners)
    assert.deepEqual(Object.keys(low.attributes).sort(), Object.keys(full.attributes).sort(), 'the shader contract is unchanged')
    for (const [name, attribute] of Object.entries(low.attributes)) assert.equal(attribute.itemSize, full.attributes[name].itemSize)
    // Silhouette, height and feet: the standing Low body occupies the same box.
    full.computeBoundingBox(); low.computeBoundingBox()
    const size = full.boundingBox.getSize(new THREE.Vector3()), lowSize = low.boundingBox.getSize(new THREE.Vector3())
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(size[axis] - lowSize[axis]) < .05, `${axis}: ${size[axis]} vs ${lowSize[axis]}`)
    assert.ok(Math.abs(full.boundingBox.min.z - low.boundingBox.min.z) < .02, 'both stand on the same floor')
  } finally { full.dispose(); low.dispose() }
})

test('full and Low draws share one pose atlas with separate topology and opaque depth writes', () => {
  const full = passengerMesh(16), low = passengerMesh(16, 'low')
  try {
    const compile = (mesh) => {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader }
      mesh.material.onBeforeCompile(shader)
      return shader
    }
    const fullShader = compile(full), lowShader = compile(low)
    for (const name of ['passengerPositions', 'passengerNormals', 'passengerRegions']) {
      assert.equal(lowShader.uniforms[name].value, fullShader.uniforms[name].value, `${name} is one GPU allocation`)
    }
    assert.notEqual(lowShader.uniforms.passengerIndices.value, fullShader.uniforms.passengerIndices.value)
    for(const [shader,stride,key] of [[lowShader,human.lowCorners,'lowIndices'],[fullShader,human.corners,'indices']]){
      const image=shader.uniforms.passengerIndices.value.image
      assert.equal(image.height,Math.ceil(human.library.length*stride/image.width))
      assert(image.height<=8192,'growing catalogues widen before exceeding the GPU row budget')
      const raw=decoded(key),source=human.indexBits===32?new Uint32Array(raw.buffer,raw.byteOffset,raw.byteLength/4):new Uint16Array(raw.buffer,raw.byteOffset,raw.byteLength/2)
      for(const variant of [0,Math.floor(human.library.length/2),human.library.length-1])for(const corner of [0,stride-1])assert.equal(image.data[variant*stride+corner],source[variant*stride+corner],'first, middle and last catalogue rows survive widening')
    }
    assert.notEqual(full.material.customProgramCacheKey(), low.material.customProgramCacheKey(), 'the two strides compile separate programs')
    assert.equal(full.material.opacity, 1, 'High bodies are fully opaque')
    assert.equal(low.material.opacity, 1, 'Low bodies are fully opaque')
    assert.equal(full.material.transparent, false)
    assert.equal(low.material.transparent, false)
    assert.equal(full.material.depthWrite, true)
    assert.equal(full.material.depthTest, true)
    assert.equal(low.material.depthTest, true)
    assert.equal(low.material.depthWrite, true)
    assert.equal(full.geometry.getAttribute('passengerPose').count, low.geometry.getAttribute('passengerPose').count, 'instance contract is shared')
  } finally { full.geometry.dispose(); full.material.dispose(); full.dispose(); low.geometry.dispose(); low.material.dispose(); low.dispose() }
})

test('高画质 draws the edited storey full and a ghosted storey reduced, per instance', () => {
  const fixture = crowdFixture('high', { ghost: true })
  const { crowd } = fixture
  try {
    assert.equal(crowd.agents.count, 2, 'the storey being edited keeps the full body')
    assert.equal(crowd.agentsLow.count, 1, 'the ghosted storey draws the reduced body')
    assert.deepEqual(levels(crowd.agents), [0, 0], 'each instance records the storey it was classified by')
    assert.deepEqual(levels(crowd.agentsLow), [-5])
    // The ghosted passenger is a person, not just a slot: its outfit and position
    // travelled into the reduced draw.
    const outfit = crowd.agentsLow.geometry.getAttribute('passengerOutfit')
    assert.equal(outfit.getX(0), passengerAppearance(11)[0])
    const matrix = new THREE.Matrix4()
    crowd.agentsLow.getMatrixAt(0, matrix)
    assert.equal(Math.round(new THREE.Vector3().setFromMatrixPosition(matrix).z), -4)
    // The two draws keep their own slot maps: a frame that only moves the edited
    // storey leaves the ghosted instance where it was.
    const ghost = crowd.agentsLow.geometry.getAttribute('passengerPose').array.slice(0, 4)
    crowd.cur[2] = 2
    crowd.renderAgents(crowd.ctx.lastStateTime + 900)
    assert.equal(crowd.agentsLow.count, 1, 'the reduced draw keeps its one passenger')
    assert.deepEqual(levels(crowd.agentsLow), [-5])
    assert.deepEqual(crowd.agentsLow.geometry.getAttribute('passengerPose').array.slice(0, 4), ghost)
  } finally { cleanup(fixture) }
})

test('a 高画质 crowd on one storey is one draw, and 显示其他层 is what adds the second', () => {
  const single = crowdFixture('high')
  try {
    assert.equal(single.crowd.agents.count, 2, 'the storey below is not drawn when 显示其他层 is off')
    assert.equal(single.crowd.agentsLow.count, 0)
  } finally { cleanup(single) }
  const ghosted = crowdFixture('high', { ghost: true })
  try {
    assert.ok(ghosted.crowd.agentsLow.count > 0, 'the ghosted storey is where the second draw comes from')
  } finally { cleanup(ghosted) }
})

test('低画质 draws the whole crowd reduced, including in Hide UI; disabled detail restores full bodies', () => {
  const low = crowdFixture('low', { ghost: true, hideUI: true })
  try {
    assert.equal(low.crowd.agents.count, 0)
    assert.equal(low.crowd.agentsLow.count, 3, 'every drawn passenger, on every storey, is reduced')
    assert.equal(low.crowd.agentsLow.material.opacity, 1)
    assert.deepEqual(levels(low.crowd.agentsLow), [0, 0, -5])
    const outfit = low.crowd.agentsLow.geometry.getAttribute('passengerOutfit')
    assert.equal(outfit.getX(2), passengerAppearance(11)[0], 'identity is repacked into the reduced draw')
  } finally { cleanup(low) }
  const hidden = crowdFixture('high', { ghost: true, hideUI: true })
  try {
    assert.equal(hidden.crowd.agents.count, 3, 'Hide UI is the presentation mode: full bodies on every storey')
    assert.equal(hidden.crowd.agentsLow.count, 0)
    assert.equal(hidden.crowd.agents.material.opacity, 1, 'presentation mode keeps people opaque')
  } finally { cleanup(hidden) }
  const disabled = crowdFixture('high', { ghost: true })
  try {
    disabled.ctx.detailEnabled = false
    disabled.crowd.applyDetail()
    disabled.crowd.renderAgents(disabled.ctx.lastStateTime + 900)
    assert.equal(disabled.crowd.agents.count, 3)
    assert.equal(disabled.crowd.agentsLow.count, 0, 'a disabled static-detail setting restores full geometry')
  } finally { cleanup(disabled) }
})

test('picking, pause, follow and the shadow blobs do not depend on which draw a person is in', () => {
  const fixture = crowdFixture('low', { ghost: true })
  const { ctx, crowd } = fixture
  try {
    const matrix = new THREE.Matrix4(), lowMatrix = new THREE.Matrix4()
    crowd.agentsLow.getMatrixAt(0, lowMatrix)
    crowd.blobs.getMatrixAt(0, matrix)
    assert.equal(crowd.blobs.count, 2, 'ghost-floor passengers draw without contact shadows')
    assert.ok(Math.abs(matrix.elements[12] - lowMatrix.elements[12]) < 1e-6)
    // Pausing freezes the displayed pose of whichever draw each person is in.
    crowd.setPlaying(false, ctx.lastStateTime + 1200)
    const frozen = crowd.agentsLow.geometry.getAttribute('passengerPose').array.slice(0, 4)
    crowd.renderAgents(ctx.lastStateTime + 1400)
    assert.deepEqual(crowd.agentsLow.geometry.getAttribute('passengerPose').array.slice(0, 4), frozen)
    crowd.setPlaying(true, ctx.lastStateTime + 1600)
    assert.ok(crowd.clipMaterials().includes(crowd.agentsLow.material), 'a cut clips both crowd draws')
    // The 选择 tool's screen-space pick never reads either mesh, so a passenger in
    // the reduced draw is still selectable by identity.
    assert.equal(typeof crowd.pickAgent, 'function')
  } finally { cleanup(fixture) }
})

test('passenger shadows follow active-storey changes and whole-station views without reallocating', () => {
  for (const quality of ['high', 'low']) {
    const fixture = crowdFixture(quality, { ghost: true })
    const { ctx, crowd } = fixture
    try {
      const buffer = crowd.blobs.instanceMatrix
      crowd.setPlaying(false, ctx.lastStateTime + 500)
      ctx.activeZ = -5
      crowd.renderAgents(ctx.lastStateTime + 600)
      assert.equal(crowd.blobs.count, 1)
      ctx.activeZ = 0
      crowd.renderAgents(ctx.lastStateTime + 600)
      assert.equal(crowd.blobs.count, 2)
      ctx.hideUI = true
      crowd.renderAgents(ctx.lastStateTime + 600)
      assert.equal(crowd.blobs.count, 3)
      ctx.hideUI = false; ctx.cutaway = true
      crowd.renderAgents(ctx.lastStateTime + 600)
      assert.equal(crowd.blobs.count, 3)
      ctx.cutaway = false
      crowd.renderAgents(ctx.lastStateTime + 600)
      assert.equal(crowd.blobs.count, 2, 'closing a cut refreshes the paused shadow prefix')
      assert.equal(crowd.blobs.instanceMatrix, buffer)
    } finally { cleanup(fixture) }
  }
})

test('tearing the scene down releases the shared atlas exactly once', () => {
  const previous = globalThis.document
  const fixture = crowdFixture('low')
  const { ctx, crowd } = fixture
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader }
  crowd.agentsLow.material.onBeforeCompile(shader)
  let disposed = 0
  for (const name of ['passengerPositions', 'passengerNormals', 'passengerIndices', 'passengerRegions']) shader.uniforms[name].value.addEventListener('dispose', () => disposed++)
  try {
    crowd.dispose()
    assert.equal(disposed, 4, 'the pose atlas and the Low index table go with the scene')
    crowd.dispose()
    assert.equal(disposed, 4, 'a repeated teardown releases nothing twice')
  } finally { ctx.mats.blob.dispose(); globalThis.document = previous }
})
