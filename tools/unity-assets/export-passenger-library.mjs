import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import validator from 'gltf-validator'
import * as T from '../../model/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../../model/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { unzlibSync } from '../../game/node_modules/three/examples/jsm/libs/fflate.module.js'
import { MeshoptSimplifier } from '../../game/node_modules/meshoptimizer/meshopt_simplifier.js'
import { createImportedSoftHuman, SOFT_BASE_URL } from '../../model/src/soft-human/imported-base.js'
import { createWardrobe, OUTFITS } from '../../model/src/soft-human/wardrobe.js'
import { createMotion } from '../../model/src/soft-human/character.js'
import { createSoftActivityPoser } from '../../model/src/soft-human/activities.js'
import { SOFT_MODEL_LIBRARY } from '../../model/src/soft-human/catalog.js'
import { ACTIVITY_NAMES, ACTIVITY_DURATION, ACTIVITY_SAMPLES, activityRailTarget } from '../../game/src/sim/activities.ts'

// Headless GLTFExporter needs a FileReader to turn its binary blob into bytes.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

// The passenger library family: one GLB per active soft-human appearance recipe.
//
// This is the whole 440-recipe `SOFT_MODEL_LIBRARY`, not the eight-recipe review
// sample in `export-crowd.mjs`. Every asset is the canonical adult (fit 1), Full
// detail recipe: the same active bake (`passenger-approved.json` /
// `passenger-activities.json`), the same 16-joint rig, the same source skin
// weights, the same baked palette regions and the same 49 standing/walk/activity
// clips. Child proportions and Low topology are runtime variants of the same
// recipe id, so they are parameters here, not additional assets.
//
// RIGHTS: the soft-human base is `HumanBody_Alt.fbx`, a game extract whose
// supplied readme carries no redistribution licence. These GLBs are therefore
// INTERNAL REVIEW FIXTURES ONLY. Do not ship or publish them, and keep the
// `passenger-production-rig` row BLOCKED until the base and its derivatives are
// cleared.

const repo = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(repo, path))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const shaText = text => sha(Buffer.from(text, 'utf8'))
const lf = path => read(path).toString('utf8').replace(/\r\n/g, '\n')

const args = process.argv.slice(2)
function flag(name, fallback = null) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const OUT = resolve(args[0] && !args[0].startsWith('--') ? args[0] : flag('out', '.preview/unity/passenger-library'))
const LIMIT = Number(flag('limit', '0')) || 0
const START = Number(flag('start', '0')) || 0
const ONLY = flag('only', null)
const VERBOSE = args.includes('--verbose')
const LOD_MESHES = args.includes('--lod-meshes')

const approved = JSON.parse(read('game/src/assets/passenger-approved.json'))
const activities = JSON.parse(read('game/src/assets/passenger-activities.json'))
const sourceLf = JSON.parse(read('game/src/assets/passenger-source-lf.json'))

// ---------------------------------------------------------------------------
// 1. Pin the exact active bake inputs before reading a single vertex.
// ---------------------------------------------------------------------------
assert.equal(approved.style, 'soft-human')
assert.equal(approved.encoding, 'zlib-base64')
assert.equal(approved.poseEncoding, 'frame-delta')
assert.equal(sourceLf.algorithm, 'sha256-utf8-lf')
assert.equal(sourceLf.recipeSha256, approved.recipeSha256)

const sourceInputs = []
for (const [path, expected] of Object.entries(approved.sourceHashes)) {
  // Mesh-only export consumes the pinned bind geometry and omits all clips.
  // The live simulation constants are only used by the clip-producing path.
  if (LOD_MESHES && path === 'game/src/sim/constants.ts') continue
  const bytes = read(path)
  const raw = sha(bytes)
  assert.equal(raw, expected, `${path} does not match the bake's raw provenance; rebake first`)
  const lfHash = shaText(lf(path))
  assert.equal(lfHash, sourceLf.sourceHashes[path],
    `${path} does not match the line-ending-neutral verification record; rebake first`)
  sourceInputs.push({ path, raw, lf: lfHash })
}
const recipeSha256 = sha(Buffer.from(JSON.stringify(approved.sourceHashes), 'utf8'))
assert.equal(recipeSha256, approved.recipeSha256, 'The active bake recipe hash is not reproducible')

const fbxPath = 'model/public' + SOFT_BASE_URL
const fbxBytes = read(fbxPath)
const sourceSha256 = sha(fbxBytes)
assert.equal(sourceSha256, approved.sourceSha256, `${fbxPath} does not match the bake's source hash`)

const decode = value => new Uint8Array(unzlibSync(Buffer.from(value, 'base64')))
const bind = new Float32Array(decode(activities.data).buffer)
const matrices = new Float32Array(decode(activities.matrices).buffer)
const indices = new Uint32Array(decode(approved.indices).buffer)
const lowIndices = new Uint32Array(decode(approved.lowIndices).buffer)
const bakedPositions = (() => {
  const values = new Int16Array(decode(approved.positions).buffer)
  const stride = approved.vertices * 3
  for (let i = stride; i < values.length; i++) values[i] += values[i - stride]
  return values
})()
const SCALE = approved.positionScale

assert.equal(activities.boneCount, 16)
assert.equal(bind.length, activities.vertices * 16)
assert.equal(matrices.length,
  activities.fits.length * activities.handModes.length * (activities.activities.length + 3) *
  activities.samples * activities.boneCount * 16)
assert.equal(activities.vertices, approved.vertices)
assert.equal(activities.recipeSha256, approved.recipeSha256)
assert.equal(activities.sourceSha256, approved.sourceSha256)
assert.equal(activities.activities.length, ACTIVITY_NAMES.length)
assert.equal(ACTIVITY_SAMPLES, activities.samples)
assert.deepEqual(ACTIVITY_DURATION.slice(), activities.durations)

// ---------------------------------------------------------------------------
// 2. Rebuild the authored rig and prove the bake still carries its joint names.
// ---------------------------------------------------------------------------
const character = createImportedSoftHuman(
  fbxBytes.buffer.slice(fbxBytes.byteOffset, fbxBytes.byteOffset + fbxBytes.byteLength))
character.setAge('adult')
character.resetPose()
character.body.position.set(0, 0, 0)
character.body.rotation.set(0, 0, 0)
character.body.scale.set(1, 1, 1)
character.body.updateMatrixWorld(true)
character.body.skeleton.update()

const boneNames = activities.boneNames
assert.equal(character.bones.length, boneNames.length, 'The baked rig is not the authored 16-bone rig')
assert.deepEqual(character.bones.map(bone => bone.name), boneNames,
  'The baked joint order no longer matches model/src/soft-human/imported-base.js')
assert.equal(character.source.bones, 15)
const boneIndex = new Map(boneNames.map((name, index) => [name, index]))
const parentIndex = character.bones.map(bone => {
  const parent = bone.parent
  return parent && parent.isBone ? boneIndex.get(parent.name) : -1
})
const inverseBinds = character.body.skeleton.boneInverses.map(matrix => matrix.clone())
assert.equal(inverseBinds.length, boneNames.length)

const authoredBones = character.bones.map(bone => ({
  name: bone.name,
  position: bone.position.clone(),
  quaternion: bone.quaternion.clone(),
  parent: parentIndex[boneIndex.get(bone.name)],
}))

// glTFExporter writes skin.skeleton from bones[0], so the root Hips has to lead
// the joint array. The bake's joint order (Hips at index 15, arms at 9-14) is
// kept for every pose decode; only the exported skin table is permuted.
const jointOrder = ['Hips', ...boneNames.filter(name => name !== 'Hips')]
const newToOld = jointOrder.map(name => boneIndex.get(name))
const oldToNew = new Map(newToOld.map((old, index) => [old, index]))
const jointParents = jointOrder.map(name => {
  const bone = character.bones[boneIndex.get(name)]
  const parent = bone.parent
  return parent && parent.isBone ? oldToNew.get(boneIndex.get(parent.name)) : -1
})
const jointInverseBinds = newToOld.map(old => inverseBinds[old])

const wardrobe = createWardrobe(character)

/** Restore the exact authored bind pose. Rigid accessory meshes hang off bones,
 *  so their authored positions must be read with the rig at rest or they drift
 *  with whatever pose the previous recipe left behind. */
function resetToBindPose() {
  character.resetPose()
  character.body.position.set(0, 0, 0)
  character.body.rotation.set(0, 0, 0)
  character.body.scale.set(1, 1, 1)
  character.body.updateMatrixWorld(true)
  character.body.skeleton.update()
}

function authoredMaterials() {
  const colors = new Set()
  const positions = []
  const vertex = new T.Vector3()
  character.body.updateMatrixWorld(true)
  character.body.skeleton.update()
  character.body.traverse(object => {
    if (!object.isMesh) return
    for (const material of [].concat(object.material)) {
      if (material?.color) colors.add('#' + material.color.getHexString())
    }
    const attribute = object.geometry.attributes.position
    for (let i = 0; i < attribute.count; i++) {
      // Skinned parts are already stored in the body's bind space; rigid
      // accessories are baked into it with their bone transform.
      vertex.fromBufferAttribute(attribute, i)
      if (!object.isSkinnedMesh) vertex.applyMatrix4(object.matrixWorld)
      positions.push(vertex.x, vertex.y, vertex.z)
    }
  })
  return { colors, positions }
}

// ---------------------------------------------------------------------------
// 3. The whole active 440-recipe catalogue. Age and detail are parameters.
// ---------------------------------------------------------------------------
const ALL_HANDS = ['default', 'right', 'left']
const ACTIVITY_CLIPS = ['WalkWait', 'Sit', 'Shop', 'Ticket', 'Vending', 'QR', 'Card', 'Escalator',
  'Lift', 'Toilet', 'Wash', 'Door', 'Wait', 'Queue', 'EscalatorLeft']
assert.equal(ACTIVITY_CLIPS.length, ACTIVITY_NAMES.length)
const HAND_SUFFIX = { default: '', right: '_Right', left: '_Left' }
const WALK_CLIPS = ['WalkSlow', 'Walk', 'WalkFast']
const CLIP_COUNT = 1 + WALK_CLIPS.length + ACTIVITY_CLIPS.length * ALL_HANDS.length
assert.equal(CLIP_COUNT, 49)
const ADULT_FIT = 1

// The prefab/model folder uses the exact recipe vocabulary: Male/Female from the
// wardrobe category and the outfit id verbatim.
const sexFolder = sex => sex === 'male' ? 'Male' : 'Female'
const modelsRoot = 'Assets/StationDesigner/Generated/Passengers/Models'
const prefabsRoot = 'Assets/StationDesigner/Generated/Passengers'
const modelPath = recipe => `${modelsRoot}/${sexFolder(recipe.character)}/${recipe.outfit}/${recipe.id}.glb`
const prefabPath = recipe => `${prefabsRoot}/${sexFolder(recipe.character)}/${recipe.outfit}/${recipe.id}.prefab`
const stagedModelPath = recipe => `Models/${sexFolder(recipe.character)}/${recipe.outfit}/${recipe.id}.glb`

// ---------------------------------------------------------------------------
// 4. Decode one recipe from the bake. Every returned vertex is a baked vertex.
// ---------------------------------------------------------------------------
const palette = approved.paletteRGB
const regionColor = index => {
  const hex = palette[index]
  assert.ok(hex, `Baked palette region ${index} is missing`)
  return hex
}

function buildGeometry(recipe, detail = 'full') {
  const stride = detail === 'low' ? approved.lowCorners : approved.corners
  const table = detail === 'low' ? lowIndices : indices
  const triangleCount = detail === 'low' ? recipe.lowTriangles : recipe.triangles
  const row = approved.library.indexOf(recipe)
  assert.ok(row >= 0, `${recipe.id} is not in the active bake`)
  let corners = Array.from(table.subarray(row * stride, row * stride + triangleCount * 3))
  if (detail === 'reduced') corners = reducePassengerCorners(corners)
  const used = [...new Set(corners)]
  const remap = new Map(used.map((vertex, index) => [vertex, index]))
  const triangles = corners.map(vertex => remap.get(vertex))

  const position = new Float32Array(used.length * 3)
  const normal = new Float32Array(used.length * 3)
  const skinIndex = new Uint16Array(used.length * 4)
  const skinWeight = new Float32Array(used.length * 4)
  const region = new Uint8Array(used.length)
  for (let i = 0; i < used.length; i++) {
    const offset = used[i] * 16
    position[i * 3] = bind[offset]
    position[i * 3 + 1] = bind[offset + 1]
    position[i * 3 + 2] = bind[offset + 2]
    normal[i * 3] = bind[offset + 4]
    normal[i * 3 + 1] = bind[offset + 5]
    normal[i * 3 + 2] = bind[offset + 6]
    region[i] = bind[offset + 7]
    for (let k = 0; k < 4; k++) {
      skinWeight[i * 4 + k] = bind[offset + 8 + k]
      skinIndex[i * 4 + k] = bind[offset + 12 + k]
    }
  }
  for (let i = 0; i < normal.length; i += 3) {
    const length = Math.hypot(normal[i], normal[i + 1], normal[i + 2])
    assert.ok(length > 1e-6, `${recipe.id}: baked bind normal is zero`)
    normal[i] /= length
    normal[i + 1] /= length
    normal[i + 2] /= length
  }

  // Every triangle must stay inside one material region; the bake splits the
  // source at garment boundaries for exactly this reason.
  const byRegion = new Map()
  for (let i = 0; i < triangles.length; i += 3) {
    const a = region[triangles[i]], b = region[triangles[i + 1]], c = region[triangles[i + 2]]
    assert.ok(a === b && b === c, `${recipe.id}: a triangle crosses baked palette regions`)
    if (!byRegion.has(a)) byRegion.set(a, [])
    byRegion.get(a).push(triangles[i], triangles[i + 1], triangles[i + 2])
  }
  const regionIds = [...byRegion.keys()].sort((a, b) => a - b)
  const ordered = []
  const groups = []
  for (const id of regionIds) {
    const list = byRegion.get(id)
    groups.push({ index: id, start: ordered.length, count: list.length, triangles: list.length / 3 })
    ordered.push(...list)
  }

  // A handbag/purse is baked per frame with the carry counter-rotation. A
  // skinned GLB can only weight it rigidly to the forearm, so tag those vertices
  // (single forearm influence, non-skin palette region) for a separate reading.
  let heldBagMask = null
  if (recipe.bagType === 'handbag' || recipe.bagType === 'purse') {
    heldBagMask = new Uint8Array(used.length)
    for (let i = 0; i < used.length; i++) {
      let count = 0, only = -1
      for (let k = 0; k < 4; k++) {
        if (skinWeight[i * 4 + k] > 0) { count++; only = skinIndex[i * 4 + k] }
      }
      const forearm = /Forearm/.test(boneNames[only] ?? '')
      if (count === 1 && forearm && regionColor(region[i]) !== '#f2f1ed') heldBagMask[i] = 1
    }
  }

  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeight, 4))
  geometry.setIndex(ordered)
  const materials = regionIds.map(id => new T.MeshStandardMaterial({
    name: `passenger-region-${String(id).padStart(2, '0')}-${regionColor(id).slice(1)}`,
    color: regionColor(id),
    roughness: 0.86,
    metalness: 0,
  }))
  for (let index = 0; index < groups.length; index++) {
    geometry.addGroup(groups[index].start, groups[index].count, index)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, materials, groups, regionIds, vertices: used.length, triangles: corners.length / 3, used, region, heldBagMask }
}

function reducePassengerCorners(corners) {
  const byRegion = Map.groupBy(Array.from({ length: corners.length / 3 }, (_, index) => index * 3),
    start => bind[corners[start] * 16 + 7])
  const result = []
  for (const offsets of byRegion.values()) {
    const regionCorners = offsets.flatMap(start => corners.slice(start, start + 3))
    const vertices = [...new Set(regionCorners)]
    const remap = new Map(vertices.map((value, index) => [value, index]))
    const local = Uint32Array.from(regionCorners, value => remap.get(value))
    const positions = Float32Array.from(vertices.flatMap(value => Array.from(bind.subarray(value * 16, value * 16 + 3))))
    const attributes = Float32Array.from(vertices.flatMap(value => {
      const start = value * 16
      const weights = Array(boneNames.length).fill(0)
      for (let slot = 0; slot < 4; slot++) weights[bind[start + 12 + slot]] += bind[start + 8 + slot]
      return weights
    }))
    const target = Math.max(3, Math.ceil(local.length / 6) * 3)
    const [reduced] = MeshoptSimplifier.simplifyWithAttributes(local, positions, 3,
      attributes, boneNames.length, Array(boneNames.length).fill(2), null, target, .01, ['LockBorder'])
    for (const index of reduced) result.push(vertices[index])
  }
  return result
}

// ---------------------------------------------------------------------------
// 5. Convert the bake's GPU skinning matrices back into local joint transforms
//    and verify the conversion reproduces the baked palette exactly.
// ---------------------------------------------------------------------------
const IDENTITY = new T.Matrix4()
const handIndex = { default: 0, right: 1, left: 2 }
const fitIndex = value => {
  const index = activities.fits.indexOf(value)
  assert.ok(index >= 0, `fit ${value} is not in the active bake`)
  return index
}

function bakingMatrices(fit, hand, action, frame) {
  const stride = activities.boneCount * 16
  const offset = (((fitIndex(fit) * activities.handModes.length + handIndex[hand]) *
    (activities.activities.length + 3) + action) * activities.samples + frame) * stride
  const result = []
  for (let bone = 0; bone < activities.boneCount; bone++) {
    result.push(new T.Matrix4().fromArray(matrices, offset + bone * 16))
  }
  return result
}

function skinGeometry(geometry, worlds) {
  const position = geometry.attributes.position
  const skinIndex = geometry.attributes.skinIndex
  const skinWeight = geometry.attributes.skinWeight
  const out = new Float32Array(position.count * 3)
  for (let vertex = 0; vertex < position.count; vertex++) {
    const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex)
    let sx = 0, sy = 0, sz = 0
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(vertex, k)
      if (!weight) continue
      const e = worlds[skinIndex.getComponent(vertex, k)].elements
      sx += (e[0] * x + e[4] * y + e[8] * z + e[12]) * weight
      sy += (e[1] * x + e[5] * y + e[9] * z + e[13]) * weight
      sz += (e[2] * x + e[6] * y + e[10] * z + e[14]) * weight
    }
    out[vertex * 3] = sx
    out[vertex * 3 + 1] = sy
    out[vertex * 3 + 2] = sz
  }
  return out
}

function composeWorlds(locals) {
  const worlds = []
  const solve = bone => {
    if (worlds[bone]) return worlds[bone]
    const parent = parentIndex[bone] >= 0 ? solve(parentIndex[bone]) : IDENTITY
    return worlds[bone] = parent.clone().multiply(new T.Matrix4().compose(
      locals[bone].position, locals[bone].quaternion, locals[bone].scale))
  }
  for (let bone = 0; bone < boneNames.length; bone++) solve(bone)
  return worlds
}

const motion = createMotion(character)
const poser = createSoftActivityPoser(character)
const baseResetPose = character.resetPose
character.resetPose = () => {
  baseResetPose()
  character.body.scale.set(
    character.appearance.age === 'child' ? 0.70 : 1,
    character.fitHeight ?? 1,
    character.appearance.age === 'child' ? 0.70 : 1)
  character.body.updateMatrixWorld(true)
}

function captureLocals() {
  return character.bones.map(bone => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }))
}

function resetBody() {
  character.body.position.set(0, 0, 0)
  character.body.rotation.set(0, 0, 0)
  character.body.scale.setScalar(1)
  character.body.updateMatrixWorld(true)
  character.body.skeleton.update()
}

/** The bake's exact standing/walking foot offset from the body skin. */
function footOffset() {
  const skin = character.body.geometry.attributes.position
  const vertex = new T.Vector3()
  let foot = Infinity
  for (let i = 0; i < skin.count; i++) {
    if (skin.getY(i) >= 0.08) continue
    character.body.applyBoneTransform(i, vertex.fromBufferAttribute(skin, i)).applyMatrix4(character.body.matrixWorld)
    foot = Math.min(foot, vertex.y)
  }
  return foot
}

/** Same sequence as the bake's frame-0 walking-atlas sample. */
function idlePose() {
  character.fitHeight = 1
  character.setAge('adult')
  motion.state.mode = 'idle'
  motion.seek(0)
  character.body.updateMatrixWorld(true)
  character.body.skeleton.update()
  const foot = footOffset()
  const bodyPosition = character.body.position.clone()
  resetBody()
  const locals = captureLocals()
  locals[boneIndex.get('Hips')].position.add(bodyPosition)
  locals[boneIndex.get('Hips')].position.y -= foot
  return locals
}

/** Same sequence as the bake's walking-atlas sample. */
function walkPose(gait, frame) {
  character.fitHeight = 1
  character.setAge('adult')
  motion.state.mode = ['walk-slow', 'walk', 'walk-fast'][gait]
  motion.seek((2 + frame / activities.samples) * approved.walkProfiles[gait].cycleSeconds)
  character.body.updateMatrixWorld(true)
  character.body.skeleton.update()
  const foot = footOffset()
  const bodyPosition = character.body.position.clone()
  resetBody()
  const locals = captureLocals()
  locals[boneIndex.get('Hips')].position.add(bodyPosition)
  locals[boneIndex.get('Hips')].position.y -= foot
  return locals
}

/** Same sequence as the bake's station-activity palette. */
function activityPose(fit, hand, action, frame) {
  const child = fit < 0.78
  character.setAge(child ? 'child' : 'adult')
  character.fitHeight = fit
  const id = ACTIVITY_NAMES[action]
  const time = ACTIVITY_DURATION[action] * frame / (activities.samples - 1)
  if (id === 'escalator' || id === 'escalator-left') {
    const side = id === 'escalator-left' ? -1 : 1
    const target = activityRailTarget(Math.floor(frame / 6), fit)
    target[0] *= side
    const stage = frame % 6
    if (stage === 1 || stage === 4) { target[0] -= side * 0.08; target[1] += 0.08 }
    poser(stage === 0 || stage === 5 ? 'wait' : id, time, { foot: [0, 0, 0], rail: target, hand })
  } else {
    poser(id === 'walk' ? 'wait' : id, time, { hand })
  }
  resetBody()
  const locals = captureLocals()
  const baked = bakingMatrices(fit, hand, action, frame)
  let error = 0
  const applied = character.body.skeleton.boneMatrices
  for (let bone = 0; bone < boneNames.length; bone++) {
    for (let element = 0; element < 16; element++) {
      error = Math.max(error, Math.abs(applied[bone * 16 + element] - baked[bone].elements[element]))
    }
  }
  assert.ok(Number.isFinite(error), `replayed ${id}/${hand}/${fit}@${frame} produced a non-finite pose`)
  assert.ok(error < 2e-4, `replayed ${id}/${hand}/${fit}@${frame} differs from the bake by ${error}`)
  return { locals, error }
}

function sampleClip(frames, indexList) {
  return indexList.map(index => {
    const bones = [], scales = []
    for (const old of newToOld) {
      const world = frames[index].worlds[old]
      const local = frames[index].locals[old]
      bones.push(world.elements[12], world.elements[13], world.elements[14])
      scales.push(local.scale.x, local.scale.y, local.scale.z)
    }
    return { time: +frames[index].time.toFixed(5), bones, scales }
  })
}

function makeClip(name, frames) {
  const times = frames.map(frame => frame.time)
  const tracks = []
  for (let bone = 0; bone < boneNames.length; bone++) {
    const positions = [], quaternions = [], scales = []
    let previous = null
    let scaled = false
    for (const frame of frames) {
      const local = frame.locals[bone]
      positions.push(local.position.x, local.position.y, local.position.z)
      const q = local.quaternion
      if (previous && previous.dot(q) < 0) quaternions.push(-q.x, -q.y, -q.z, -q.w)
      else quaternions.push(q.x, q.y, q.z, q.w)
      previous = q
      scales.push(local.scale.x, local.scale.y, local.scale.z)
      if (Math.abs(local.scale.x - 1) > 1e-6 || Math.abs(local.scale.y - 1) > 1e-6 ||
          Math.abs(local.scale.z - 1) > 1e-6) scaled = true
    }
    tracks.push(new T.QuaternionKeyframeTrack(`${boneNames[bone]}.quaternion`, times, quaternions))
    tracks.push(new T.VectorKeyframeTrack(`${boneNames[bone]}.position`, times, positions))
    // The child fit carries the approved 1.08 head scale in its activity poses.
    if (scaled) tracks.push(new T.VectorKeyframeTrack(`${boneNames[bone]}.scale`, times, scales))
  }
  return new T.AnimationClip(name, times[times.length - 1], tracks)
}

/** Standing + three walk clips: independent of height fit and carried bag. */
function buildSharedClips() {
  const clips = []
  const idleLocals = idlePose()
  const idleFrames = [0, 1].map(time => ({ time, locals: idleLocals, worlds: composeWorlds(idleLocals) }))
  clips.push({
    name: 'Idle', duration: 1, frames: idleFrames,
    samples: sampleClip(idleFrames, [0, 1]), track: makeClip('Idle', idleFrames),
  })

  for (let gait = 0; gait < WALK_CLIPS.length; gait++) {
    const cycle = approved.walkProfiles[gait].cycleSeconds
    const frames = []
    for (let frame = 0; frame < activities.samples; frame++) {
      const locals = walkPose(gait, frame)
      frames.push({ time: cycle * frame / activities.samples, locals, worlds: composeWorlds(locals) })
    }
    frames.push({ time: cycle, locals: frames[0].locals, worlds: frames[0].worlds })
    clips.push({
      name: WALK_CLIPS[gait], duration: cycle, frames,
      samples: sampleClip(frames, [0, 8, 16, 23]), track: makeClip(WALK_CLIPS[gait], frames),
    })
  }
  return clips
}

/** The 45 station-activity clips (15 actions x 3 hand modes) for one fit. */
function buildActivityClips(fit) {
  const clips = []
  let activityMatrixMaxError = 0
  for (const hand of activities.handModes) {
    for (let action = 0; action < activities.activities.length; action++) {
      const duration = ACTIVITY_DURATION[action]
      const frames = []
      for (let frame = 0; frame < activities.samples; frame++) {
        const pose = activityPose(fit, hand, action, frame)
        activityMatrixMaxError = Math.max(activityMatrixMaxError, pose.error)
        frames.push({
          time: duration * frame / (activities.samples - 1),
          locals: pose.locals,
          worlds: composeWorlds(pose.locals),
        })
      }
      const name = ACTIVITY_CLIPS[action] + HAND_SUFFIX[hand]
      clips.push({
        name, duration, frames,
        samples: sampleClip(frames, [0, 8, 16, 23]), track: makeClip(name, frames),
      })
    }
  }
  assert.equal(clips.length, activities.activities.length * activities.handModes.length)
  return { clips, activityMatrixMaxError }
}

/** Max distance between the exported pose and the game's baked atlas frame.
 *  A held handbag/purse is baked per frame with the carry counter-rotation; a
 *  Unity skinned mesh can only weight it rigidly to the forearm, so those
 *  vertices are measured separately instead of silently inflating the walk. */
function compareToAtlas(geometry, worlds, frame, heldBagMask = null) {
  const skinning = worlds.map((world, bone) => world.clone().multiply(inverseBinds[bone]))
  const skinned = skinGeometry(geometry, skinning)
  const used = geometry.userData.used
  let worst = 0, heldBagWorst = 0
  for (let i = 0; i < used.length; i++) {
    const offset = (frame * approved.vertices + used[i]) * 3
    // Baked attribute order is (three z, three x, three y - foot); the atlas
    // frame already has the foot offset removed, so three y = attribute y.
    const x = bakedPositions[offset + 1] / SCALE
    const y = bakedPositions[offset + 2] / SCALE
    const z = bakedPositions[offset] / SCALE
    const distance = Math.hypot(skinned[i * 3] - x, skinned[i * 3 + 1] - y, skinned[i * 3 + 2] - z)
    if (heldBagMask && heldBagMask[i]) heldBagWorst = Math.max(heldBagWorst, distance)
    else worst = Math.max(worst, distance)
  }
  return { worst, heldBagWorst }
}

// ---------------------------------------------------------------------------
// 6. Export every active recipe.
// ---------------------------------------------------------------------------
mkdirSync(join(OUT, 'Models'), { recursive: true })
mkdirSync(join(OUT, 'manifests'), { recursive: true })
mkdirSync(join(OUT, 'validation'), { recursive: true })

function buildSkinnedScene(geometry, materials, clips) {
  const authored = new Map(authoredBones.map(bone => [bone.name, bone]))
  const bones = jointOrder.map(name => {
    const source = authored.get(name)
    const bone = new T.Bone()
    bone.name = source.name
    bone.position.copy(source.position)
    bone.quaternion.copy(source.quaternion)
    return bone
  })
  for (let index = 0; index < bones.length; index++) {
    const parent = jointParents[index]
    if (parent >= 0) bones[parent].add(bones[index])
  }
  // The bake's joint table leads with its Hips root; glTFExporter writes
  // skin.skeleton from bones[0], so the exported skin uses the permuted table.
  const exportGeometry = geometry.clone()
  const skinIndex = exportGeometry.attributes.skinIndex
  const skinWeight = exportGeometry.attributes.skinWeight
  for (let vertex = 0; vertex < skinIndex.count; vertex++) {
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(vertex, k)
      // glTF validators reject a non-zero joint id in a zero-weight slot.
      skinIndex.setComponent(vertex, k, weight > 0 ? oldToNew.get(skinIndex.getComponent(vertex, k)) : 0)
    }
  }
  const mesh = new T.SkinnedMesh(exportGeometry, materials)
  mesh.name = 'SoftHumanBody'
  mesh.castShadow = true
  mesh.add(bones[0])
  mesh.updateMatrixWorld(true)
  const skeleton = new T.Skeleton(bones)
  for (let index = 0; index < bones.length; index++) {
    const expected = jointInverseBinds[index].elements, actual = skeleton.boneInverses[index].elements
    for (let element = 0; element < 16; element++) {
      assert.ok(Math.abs(expected[element] - actual[element]) < 1e-5,
        `export skeleton inverse bind ${jointOrder[index]} drifted from imported-base.js`)
    }
  }
  mesh.bind(skeleton)
  return { mesh, tracks: clips.map(clip => clip.track) }
}

function authoredRegionCheck(recipe, geometry, authored) {
  const expected = geometry.groups.map(group => regionColor(group.index))
  for (const color of expected) {
    assert.ok(authored.colors.has(color),
      `${recipe.id}: baked region ${color} is not an authored ${recipe.outfit} colour (${[...authored.colors].join(',')})`)
  }
  return expected
}

/** Every sampled baked bind vertex must sit on the authored source surface. */
function authoredGeometryCheck(recipe, geometry, authored) {
  const positions = authored.positions
  const samples = []
  for (let i = 0; i < geometry.used.length; i += Math.max(1, Math.floor(geometry.used.length / 240))) samples.push(i)
  let worst = 0
  for (const index of samples) {
    const offset = geometry.used[index] * 16
    const x = bind[offset], y = bind[offset + 1], z = bind[offset + 2]
    let best = Infinity
    for (let p = 0; p < positions.length; p += 3) {
      const distance = (positions[p] - x) ** 2 + (positions[p + 1] - y) ** 2 + (positions[p + 2] - z) ** 2
      if (distance < best) best = distance
    }
    worst = Math.max(worst, Math.sqrt(best))
  }
  // The bake simplifies and trims the authored parts, so a surviving vertex can
  // sit up to a couple of centimetres inside a source face; the pose comparison
  // against the bake itself is the exact check.
  assert.ok(worst < 0.02,
    `${recipe.id}: baked bind vertex is ${worst.toFixed(4)} m from the authored source surface`)
  return +worst.toFixed(5)
}

/** The authored wardrobe colours for one outfit, including the bag palette. */
function outfitRecord(outfitId) {
  const outfit = OUTFITS.find(entry => entry.id === outfitId)
  assert.ok(outfit, `Unknown outfit ${outfitId}`)
  return outfit
}

/**
 * Which baked material regions belong to the accessory.
 *
 * Clothing lives in the fixed eight-slot wardrobe palette (skin, top, bottom,
 * trim, trim/beach/formal accent, dark, tie, trim), while every bag uses the
 * outfit's own `bag` colour (or the formal leather tone for a formal outfit).
 * That colour is never one of the clothing slots, so a region carrying it is
 * accessory geometry. The hiking bedroll reuses `trim`, so it is recorded but
 * not counted here.
 */
function accessoryRecord(recipe) {
  const outfit = outfitRecord(recipe.outfit)
  if (recipe.bagStyle === 'none') return { id: 'none', color: null, clips: [], regions: [], triangles: 0 }
  const color = recipe.bagType === 'handbag' || recipe.bagType === 'purse' || recipe.bagType === 'shoulder' || recipe.bagType === 'crossbody'
    ? (outfit.formal ? '#654b3f' : outfit.bag)
    : outfit.bag
  return { id: recipe.bagStyle, color, type: recipe.bagType, side: recipe.bagSide }
}

const assets = []
const failures = []
let sharedClips = null
const activitySets = new Map()
let sharedWorst = { activity: 0, idle: 0, walk: 0, held: 0, sourceVertex: 0 }
const started = Date.now()
let sequence = START

const selected = ONLY
  ? SOFT_MODEL_LIBRARY.filter(entry => entry.id === ONLY)
  : SOFT_MODEL_LIBRARY.slice(START, LIMIT ? START + LIMIT : undefined)
assert.ok(selected.length > 0, 'No recipes selected')

if (LOD_MESHES) {
  await MeshoptSimplifier.ready
  const written = []
  for (const catalogue of selected) {
    const recipe = approved.library.find(row => row.id === catalogue.id)
    assert.ok(recipe, `No baked appearance for ${catalogue.id}`)
    for (const [tier, detail] of [[1, 'reduced'], [2, 'low']]) {
      const built = buildGeometry(recipe, detail)
      const { mesh } = buildSkinnedScene(built.geometry, built.materials, [])
      const file = stagedModelPath(recipe).replace(/\.glb$/, `-lod${tier}.glb`)
      const target = join(OUT, file)
      const bytes = new Uint8Array(await new GLTFExporter().parseAsync(mesh, { binary: true }))
      const report = await validator.validateBytes(bytes, { uri: file })
      assert.equal(report.issues.numErrors + report.issues.numWarnings, 0, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      written.push({ recipe: recipe.id, tier, file, vertices: built.vertices,
        triangles: built.triangles, sha256: sha(bytes), rights: 'INTERNAL_REVIEW_ONLY' })
      mesh.geometry.dispose()
      built.geometry.dispose()
      for (const material of built.materials) material.dispose()
    }
  }
  writeFileSync(join(OUT, 'passenger-lods.json'), JSON.stringify({ recipeSha256, sourceSha256, assets: written }, null, 2) + '\n')
  if (args.includes('--stage-local-lods')) {
    assert.equal(written.length, SOFT_MODEL_LIBRARY.length * 2, 'Stage the complete local library in one run')
    const target = 'unity/Assets/StationDesigner/Generated/Passengers/Lods'
    mkdirSync(target, { recursive: true })
    cpSync(join(OUT, 'Models'), join(target, 'Models'), { recursive: true })
    cpSync(join(OUT, 'passenger-lods.json'), join(target, 'passenger-lods.json'))
  }
  console.log(`PASSENGER_LOD_EXPORT ${written.length} meshes`)
  process.exit(0)
}

for (const [position, catalogue] of selected.entries()) {
  const recipe = approved.library.find(entry => entry.id === catalogue.id)
  try {
    assert.ok(recipe, `${catalogue.id} is not in the active 440-recipe bake`)
    assert.equal(catalogue.outfit, recipe.outfit)
    assert.equal(catalogue.bagStyle, recipe.bagStyle)
    assert.equal(catalogue.garmentShape, recipe.garmentShape)
    assert.equal(catalogue.character, recipe.character)
    assert.equal(recipe.sourceSha256, approved.sourceSha256)
    assert.equal(recipe.recipeSha256, approved.recipeSha256)

    const built = buildGeometry(recipe, 'full')
    built.geometry.userData.used = built.used

    wardrobe.set(recipe.outfit, recipe.bagStyle)
    resetToBindPose()
    const authored = authoredMaterials()
    const expectedRegions = authoredRegionCheck(recipe, built, authored)
    const sourceVertexError = recipe.id === 'soft-male-commuter-daypack'
      ? authoredGeometryCheck(recipe, built, authored)
      : 0
    sharedWorst.sourceVertex = Math.max(sharedWorst.sourceVertex, sourceVertexError)

    // Activity poses use the authored carry state; the shared idle/walk clips do
    // not depend on it for this rig, but the cache keeps the export code honest.
    const clipKey = `${ADULT_FIT}|${character.carry?.side ?? 0}|${character.carry && ['handbag', 'purse'].includes(character.carry.type) ? 'held' : 'free'}`
    if (!sharedClips) sharedClips = buildSharedClips()
    if (!activitySets.has(clipKey)) activitySets.set(clipKey, buildActivityClips(ADULT_FIT))
    const activitySet = activitySets.get(clipKey)
    const { activityMatrixMaxError } = activitySet
    const clips = [...sharedClips, ...activitySet.clips]
    assert.equal(clips.length, CLIP_COUNT, `${recipe.id}: unexpected clip count`)

    // Compare the exported standing/walk clips with the game's baked atlas
    // frames for *this* recipe. Activities are compared through the replay of
    // the bake's own pose code and its skinning-matrix palette in activityPose().
    let idleFrameMax = 0, walkFrameMax = 0, heldBagMax = 0
    const idleCompare = compareToAtlas(built.geometry, clips[0].frames[0].worlds, 0, built.heldBagMask)
    idleFrameMax = idleCompare.worst
    heldBagMax = Math.max(heldBagMax, idleCompare.heldBagWorst)
    for (let gait = 0; gait < WALK_CLIPS.length; gait++) {
      const clip = clips[1 + gait]
      for (let frame = 0; frame < activities.samples; frame++) {
        const compare = compareToAtlas(built.geometry, clip.frames[frame].worlds,
          approved.walkProfiles[gait].firstFrame + frame, built.heldBagMask)
        walkFrameMax = Math.max(walkFrameMax, compare.worst)
        heldBagMax = Math.max(heldBagMax, compare.heldBagWorst)
      }
    }
    sharedWorst.idle = Math.max(sharedWorst.idle, idleFrameMax)
    sharedWorst.walk = Math.max(sharedWorst.walk, walkFrameMax)
    sharedWorst.held = Math.max(sharedWorst.held, heldBagMax)
    sharedWorst.activity = Math.max(sharedWorst.activity, activityMatrixMaxError)

    const scene = buildSkinnedScene(built.geometry, built.materials, clips)
    const bytes = new Uint8Array(await new GLTFExporter().parseAsync(scene.mesh, {
      binary: true,
      animations: scene.tracks,
    }))
    const file = `${recipe.id}.glb`
    const report = await validator.validateBytes(bytes, { uri: file })
    const target = join(OUT, stagedModelPath(recipe))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    writeFileSync(join(OUT, 'validation', `${recipe.id}.validation.json`), JSON.stringify(report, null, 2) + '\n')
    assert.equal(report.issues.numErrors + report.issues.numWarnings, 0,
      `${file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings`)
    const validation = { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos }
    const digest = sha(bytes)

    const bounds = built.geometry.boundingBox
    const outfit = outfitRecord(recipe.outfit)
    const accessory = accessoryRecord(recipe)
    const regionTriangleCount = color => built.groups
      .filter(group => regionColor(group.index) === color)
      .reduce((sum, group) => sum + group.triangles, 0)
    const accessoryRegions = accessory.color
      ? built.groups.filter(group => regionColor(group.index) === accessory.color)
      : []
    const accessoryTriangles = accessoryRegions.reduce((sum, group) => sum + group.triangles, 0)
    const topTriangles = regionTriangleCount(outfit.top)
    const bottomTriangles = regionTriangleCount(outfit.bottom)
    assert.ok(topTriangles > 0, `${recipe.id}: no triangles in the outfit top colour ${outfit.top}`)
    assert.ok(bottomTriangles > 0, `${recipe.id}: no triangles in the outfit bottom colour ${outfit.bottom}`)
    if (recipe.bagStyle !== 'none') {
      // A bag colour must not collide with the clothing palette, otherwise the
      // region split could not prove accessory geometry.
      const clothing = new Set(['#f2f1ed', outfit.top, outfit.bottom, outfit.trim, '#263039', outfit.tie].filter(Boolean))
      assert.ok(!clothing.has(accessory.color),
        `${recipe.id}: accessory colour ${accessory.color} collides with the ${recipe.outfit} clothing palette`)
      assert.ok(accessoryTriangles > 0,
        `${recipe.id}: the ${recipe.bagStyle} accessory has no baked geometry`)
    } else {
      assert.equal(accessoryTriangles, 0, `${recipe.id}: an unbagged recipe carries accessory geometry`)
    }

    const manifest = {
      schemaVersion: 1,
      family: 'passenger-library',
      id: recipe.id,
      sequence: sequence++,
      recipe: recipe.id,
      sex: recipe.character,
      sexFolder: sexFolder(recipe.character),
      outfit: recipe.outfit,
      outfitLabel: outfit.label,
      accessory: recipe.bagStyle,
      accessoryType: recipe.bagType,
      accessorySide: recipe.bagType === 'none' ? null : recipe.bagSide,
      garmentShape: recipe.garmentShape,
      role: 'adult',
      fit: ADULT_FIT,
      detail: 'full',
      scale: [1, 1, 1],
      modelPath: modelPath(recipe),
      prefabPath: prefabPath(recipe),
      rights: 'INTERNAL_REVIEW_ONLY',
      units: 'metres',
      baseHeightMetres: approved.height,
      triangles: built.triangles,
      vertices: built.vertices,
      materials: built.groups.map(group => ({
        name: `passenger-region-${String(group.index).padStart(2, '0')}-${regionColor(group.index).slice(1)}`,
        color: regionColor(group.index),
        region: group.index,
        triangles: group.triangles,
      })),
      regionTriangles: { total: built.triangles, top: topTriangles, bottom: bottomTriangles, accessory: accessoryTriangles },
      outfitColors: { top: outfit.top, bottom: outfit.bottom, trim: outfit.trim, tie: outfit.tie ?? null, bag: outfit.bag },
      authoredRegionColors: expectedRegions,
      accessoryRecord: {
        id: accessory.id,
        color: accessory.color,
        triangles: accessoryTriangles,
        regions: accessoryRegions.map(group => group.index),
      },
      assetHeightMetres: +(bounds.max.y - bounds.min.y).toFixed(5),
      bounds: {
        min: bounds.min.toArray().map(value => +value.toFixed(5)),
        max: bounds.max.toArray().map(value => +value.toFixed(5)),
        size: bounds.getSize(new T.Vector3()).toArray().map(value => +value.toFixed(5)),
      },
      boneCount: boneNames.length,
      bones: jointOrder,
      skin: '16 joints, four-influence source weights, one skinned mesh; no merged or flattened skin',
      clips: clips.map(clip => ({
        name: clip.name,
        duration: +clip.duration.toFixed(5),
        keys: clip.frames.length,
      })),
      clipCount: clips.length,
      handModes: ALL_HANDS,
      low: {
        runtimeVariant: true,
        triangles: recipe.lowTriangles,
        ratio: +(recipe.lowTriangles / recipe.triangles).toFixed(5),
        sharedVertexPool: true,
      },
      child: { runtimeVariant: true, reason: 'age scales the same prefab at runtime; no separate recipe id' },
      comparison: {
        activityMatrixMaxError: +activityMatrixMaxError.toExponential(2),
        idleFrameMaxMetres: +idleFrameMax.toFixed(6),
        walkFrameMaxMetres: +walkFrameMax.toFixed(6),
        heldAccessoryMaxMetres: +heldBagMax.toFixed(6),
        heldAccessory: heldBagMax > 0
          ? 'rigid forearm weight; the bake animates the handbag carry counter-rotation per frame'
          : '',
        authoredSourceVertexMaxMetres: sourceVertexError,
      },
      bytes: bytes.length,
      sha256: digest,
      validation,
    }
    manifest.triangles = built.triangles
    manifest.vertices = built.vertices
    writeFileSync(join(OUT, 'manifests', `${recipe.id}.json`), JSON.stringify(manifest, null, 2) + '\n')
    assets.push(manifest)

    if (VERBOSE || position % 20 === 0 || position === selected.length - 1) {
      const elapsed = (Date.now() - started) / 1000
      const rate = (position + 1) / elapsed
      console.log(`${position + 1}/${selected.length} ${recipe.id} ` +
        `${built.triangles}t/${built.vertices}v ${built.materials.length} regions ` +
        `${clips.length} clips acc=${accessoryTriangles}t ${(bytes.length / 1024).toFixed(0)}KB ` +
        `walk=${walkFrameMax.toFixed(5)}m held=${heldBagMax.toFixed(3)}m ${rate.toFixed(2)}/s`)
    }
  } catch (error) {
    failures.push({ recipe: catalogue.id, message: error?.message ?? String(error) })
    console.error(`FAILED ${catalogue.id}: ${error?.stack ?? error}`)
  }
}

// ---------------------------------------------------------------------------
// 7. Coverage, manifest and the rights record.
// ---------------------------------------------------------------------------
const summary = {
  schemaVersion: 1,
  family: 'passenger-library',
  rights: {
    status: 'INTERNAL_REVIEW_ONLY',
    source: 'model/public' + SOFT_BASE_URL,
    license: 'The supplied readme describes a cleaned Human: Fall Flat game extract and supplies no redistribution licence.',
    production: 'BLOCKED — passenger-production-rig stays blocked until the base and its derivatives are cleared for redistribution.',
    note: 'Review-only parity fixtures. Do not publish or ship this passenger library.',
  },
  source: {
    path: 'model/public' + SOFT_BASE_URL,
    sha256: sourceSha256,
    recipeSha256: approved.recipeSha256,
    normalizedRecipeSha256: sourceLf.recipeSha256,
    inputs: sourceInputs,
    bake: ['game/src/assets/passenger-approved.json', 'game/src/assets/passenger-activities.json',
      'game/src/assets/passenger-source-lf.json'],
  },
  parameters: {
    models: assets.length,
    expected: 440,
    recipeCount: approved.library.length,
    boneCount: activities.boneCount,
    fitCount: activities.fits.length,
    sampleCount: activities.samples,
    walkFrames: approved.walkFrames,
    frames: approved.frames,
    paletteCount: approved.paletteRGB.length,
    baseHeightMetres: approved.height,
    fits: activities.fits,
    handModes: activities.handModes,
    activities: activities.activities,
    boneNames: jointOrder,
    bakeBoneNames: boneNames,
    jointRootIndex: 0,
    bakeRootIndex: activities.rootBone,
    armJointIndices: jointOrder.flatMap((name, index) => /Arm|Forearm/.test(name) ? [index] : []),
    clips: assets[0]?.clips.map(clip => clip.name) ?? [],
    clipDurations: assets[0]?.clips.map(clip => clip.duration) ?? [],
    clipCount: CLIP_COUNT,
    walkProfiles: approved.walkProfiles,
    layout: {
      models: `${modelsRoot}/<Male|Female>/<outfit>/<recipe>.glb`,
      prefabs: `${prefabsRoot}/<Male|Female>/<outfit>/<recipe>.prefab`,
      folderRule: 'Male/Female from the wardrobe category; the outfit folder is the exact outfit id',
    },
    rig: 'soft-human selected FBX base: 15 source bones rebased with a Hips root — 16 joints, source skin weights, baked palette regions',
    skinning: 'The bake stores the source four-influence weights; every exported vertex sums to 1 and keeps its source joints',
    geometry: 'One skinned mesh per recipe rebuilt from the active bake bind pool; the exact baked full index table is used',
    animation: 'The bake stores GPU skinning matrices for 8 height fits, 3 hand modes, 15 activities and 3 walks; this export inverts them to local joint tracks and grounds the standing/walk clips exactly as the atlas does',
    variants: {
      child: 'runtime age variant of the same recipe id (approved 65% height / 70% width fit); the SoftHumanChild review prefab is the sample',
      low: 'runtime detail variant of the same recipe id (shared baked vertex pool, <10% triangles); the retained low-detail GLB is soft-human-adult-commuter-daypack-low.glb',
    },
    comparison: {
      activityMatrixMaxError: +sharedWorst.activity.toExponential(2),
      idleFrameMaxMetres: +sharedWorst.idle.toFixed(6),
      walkFrameMaxMetres: +sharedWorst.walk.toFixed(6),
      heldAccessoryMaxMetres: +sharedWorst.held.toFixed(6),
      authoredSourceVertexMaxMetres: sharedWorst.sourceVertex,
    },
    rights: 'INTERNAL_REVIEW_ONLY; production-rig blocked',
    provenance: 'Derived from the active soft-human bake. The base is a game extract without a redistribution licence; clothing, accessories and motion adapters are locally authored.',
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
  failures,
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')

const header = '| # | Recipe | Sex | Outfit | Accessory | Model | Triangles | Vertices | Regions | Clips | Bytes | Validator |'
const rule = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
const rows = assets.map(asset =>
  `| ${asset.sequence} | \`${asset.recipe}\` | ${asset.sex} | \`${asset.outfit}\` | \`${asset.accessory}\` | ` +
  `\`${asset.modelPath.replace('Assets/StationDesigner/Generated/Passengers/', '')}\` | ${asset.triangles} | ` +
  `${asset.vertices} | ${asset.materials.length} | ${asset.clips.length} | ${asset.bytes} | ` +
  `${asset.validation.errors}/${asset.validation.warnings} |`)
writeFileSync(join(OUT, 'coverage.md'), `# Passenger library coverage\n\n` +
  `One canonical adult (fit 1), Full-detail GLB per active recipe id. Child and Low are runtime ` +
  `variants of these ids, so 440 recipes produce 440 assets.\n\n` +
  `${header}\n${rule}\n${rows.join('\n')}\n`)
writeFileSync(join(OUT, 'coverage.csv'), 'sequence,recipe,sex,outfit,accessory,model,prefab,triangles,vertices,regions,clips,bytes,errors,warnings,sha256\n' +
  assets.map(asset => [asset.sequence, asset.recipe, asset.sex, asset.outfit, asset.accessory, asset.modelPath,
    asset.prefabPath, asset.triangles, asset.vertices, asset.materials.length, asset.clips.length,
    asset.bytes, asset.validation.errors, asset.validation.warnings, asset.sha256].join(',')).join('\n') + '\n')

const bySex = assets.reduce((map, asset) => (map[asset.sex] = (map[asset.sex] ?? 0) + 1, map), {})
const byOutfit = assets.reduce((map, asset) => (map[`${asset.sex}/${asset.outfit}`] =
  (map[`${asset.sex}/${asset.outfit}`] ?? 0) + 1, map), {})
console.log(`PASSENGER_LIBRARY_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED ` +
  `source=${sourceSha256.slice(0, 12)} recipe=${approved.recipeSha256.slice(0, 12)}`)
console.log(`PASSENGER_LIBRARY_EXPORT ${assets.length}/${selected.length} recipes, ${CLIP_COUNT} clips each, ` +
  `${summary.validation.errors} errors, ${summary.validation.warnings} warnings, ` +
  `sex=${JSON.stringify(bySex)}, outfits=${Object.keys(byOutfit).length}, failures=${failures.length} -> ${OUT}`)
if (failures.length) {
  for (const failure of failures) console.error(`  ${failure.recipe}: ${failure.message}`)
  process.exitCode = 1
}
