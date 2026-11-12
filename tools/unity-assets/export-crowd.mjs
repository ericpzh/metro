import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import validator from 'gltf-validator'
import * as T from '../../model/node_modules/three/build/three.module.js'
import { GLTFExporter } from '../../model/node_modules/three/examples/jsm/exporters/GLTFExporter.js'
import { unzlibSync } from '../../game/node_modules/three/examples/jsm/libs/fflate.module.js'
import { createImportedSoftHuman, SOFT_BASE_URL } from '../../model/src/soft-human/imported-base.js'
import { createWardrobe } from '../../model/src/soft-human/wardrobe.js'
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

// The crowd (客流) family: the active soft-human crowd as the game actually
// renders it, re-expressed as one skinned GLB per representative recipe.
//
// This supersedes the original stand-in (`export-passenger.mjs`) for review
// evidence. The geometry, material regions and standing/walk/activity poses are
// taken from the active bake (`passenger-approved.json` /
// `passenger-activities.json`) after every recipe input hash is checked against
// `passenger-source-lf.json`. The 16-bone rig, its rest transforms and the
// authored wardrobe palette are read from `model/src/soft-human/imported-base.js`
// and `wardrobe.js`; the bake is the same constructor output the game consumes.
//
// RIGHTS: the soft-human base is `HumanBody_Alt.fbx`, a game extract whose
// supplied readme carries no redistribution licence. These GLBs are therefore
// INTERNAL REVIEW FIXTURES ONLY. Do not ship or publish this crowd, and keep the
// production-rig row BLOCKED until the base and its derivatives are cleared.

const repo = resolve(import.meta.dirname, '../..')
const read = path => readFileSync(resolve(repo, path))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const shaText = text => sha(Buffer.from(text, 'utf8'))
const lf = path => read(path).toString('utf8').replace(/\r\n/g, '\n')

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

// The same authored wardrobe constructors that feed the bake. This is used to
// (a) rebuild every recipe's authored material colours and (b) prove the baked
// bind vertices are source vertices with their source weights.
const wardrobe = createWardrobe(character)

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
// 3. Representative recipes taken from the active 440-recipe catalogue.
// ---------------------------------------------------------------------------
const ALL_HANDS = ['default', 'right', 'left']
const SPECS = [
  {
    id: 'crowd.adult-commuter-daypack', prefab: 'SoftHumanAdult', file: 'soft-human-adult-commuter-daypack.glb',
    recipe: 'soft-male-commuter-daypack', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m adult, commuter wardrobe, small daypack, full topology (primary proof)',
  },
  {
    id: 'crowd.child-commuter-daypack', prefab: 'SoftHumanChild', file: 'soft-human-child-commuter-daypack.glb',
    recipe: 'soft-male-commuter-daypack', role: 'child', fit: 0.6, hands: ALL_HANDS, detail: 'full', scale: [0.70, 0.65, 0.70],
    label: 'child at the approved 65% height / 70% width fit, commuter wardrobe, small daypack',
  },
  {
    id: 'crowd.adult-navy-suit-crossbody', prefab: 'SoftHumanFormal', file: 'soft-human-adult-navy-suit-crossbody.glb',
    recipe: 'soft-male-navy-suit-crossbody-left', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m adult, navy formal suit (lapel/cuff/tie regions), left crossbody strap',
  },
  {
    id: 'crowd.adult-blouse-skirt-handbag', prefab: 'SoftHumanSkirt', file: 'soft-human-adult-blouse-skirt-handbag.glb',
    recipe: 'soft-female-blouse-skirt-handbag-left', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m female adult, blouse/midi skirt, left handbag (hand-owned carry pose)',
  },
  {
    id: 'crowd.adult-commuter-hiking', prefab: 'SoftHumanHiking', file: 'soft-human-adult-commuter-hiking.glb',
    recipe: 'soft-male-commuter-hiking', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m adult, commuter wardrobe, hiking pack with bedroll and both shoulder straps',
  },
  {
    id: 'crowd.adult-tee-shorts', prefab: 'SoftHumanCasual', file: 'soft-human-adult-tee-shorts.glb',
    recipe: 'soft-male-tee-shorts-none', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m adult, short-sleeve cotton tee and shorts, no bag',
  },
  {
    id: 'crowd.adult-stripe-shoulder', prefab: 'SoftHumanShoulder', file: 'soft-human-adult-stripe-shoulder.glb',
    recipe: 'soft-male-stripe-shoulder-right', role: 'adult', fit: 1, hands: ALL_HANDS, detail: 'full', scale: [1, 1, 1],
    label: '1.70 m adult, striped outfit, right shoulder bag',
  },
  {
    id: 'crowd.adult-commuter-daypack-low', prefab: 'SoftHumanLow', file: 'soft-human-adult-commuter-daypack-low.glb',
    recipe: 'soft-male-commuter-daypack', role: 'adult-low', fit: 1, hands: ALL_HANDS, detail: 'low', scale: [1, 1, 1],
    label: '1.70 m adult, commuter wardrobe, small daypack, baked Low topology (<10% triangles)',
  },
]

const ACTIVITY_CLIPS = ['WalkWait', 'Sit', 'Shop', 'Ticket', 'Vending', 'QR', 'Card', 'Escalator',
  'Lift', 'Toilet', 'Wash', 'Door', 'Wait', 'Queue', 'EscalatorLeft']
assert.equal(ACTIVITY_CLIPS.length, ACTIVITY_NAMES.length)
const HAND_SUFFIX = { default: '', right: '_Right', left: '_Left' }
const WALK_CLIPS = ['WalkSlow', 'Walk', 'WalkFast']
const WALK_ACTIONS = [15, 16, 17]
const IDLE_ACTION = 12

// ---------------------------------------------------------------------------
// 4. Decode one recipe from the bake. Every returned vertex is a baked vertex.
// ---------------------------------------------------------------------------
const palette = approved.paletteRGB
const regionColor = index => {
  const hex = palette[index]
  assert.ok(hex, `Baked palette region ${index} is missing`)
  return hex
}

function buildGeometry(recipe, detail) {
  const stride = detail === 'low' ? approved.lowCorners : approved.corners
  const table = detail === 'low' ? lowIndices : indices
  const triangleCount = detail === 'low' ? recipe.lowTriangles : recipe.triangles
  const row = approved.library.indexOf(recipe)
  assert.ok(row >= 0, `${recipe.id} is not in the active bake`)
  const corners = Array.from(table.subarray(row * stride, row * stride + triangleCount * 3))
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
    name: `crowd-region-${String(id).padStart(2, '0')}-${regionColor(id).slice(1)}`,
    color: regionColor(id),
    roughness: 0.86,
    metalness: 0,
  }))
  for (let index = 0; index < groups.length; index++) {
    geometry.addGroup(groups[index].start, groups[index].count, index)
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, materials, groups, regionIds, vertices: used.length, triangles: triangleCount, used, region, heldBagMask }
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

// Replay the bake's own posing code rather than inverting its skinning matrices:
// the constructors are the source of truth and the bake's matrices are what we
// verify each replay against.
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


function sampleClip(frames, indices) {
  return indices.map(index => {
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
// 6. Export each representative recipe.
// ---------------------------------------------------------------------------
const out = resolve(process.argv[2] ?? '.preview/unity/crowd-proof/export')
mkdirSync(out, { recursive: true })

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

const assets = []
let sharedClips = null
const activitySets = new Map()
const authoredCache = new Map()
let sharedWorst = { activity: 0, idle: 0, walk: 0, held: 0, sourceVertex: 0 }
for (const spec of SPECS) {
  const recipe = approved.library.find(entry => entry.id === spec.recipe)
  assert.ok(recipe, `${spec.recipe} is not in the active 440-recipe bake`)
  const catalogue = SOFT_MODEL_LIBRARY.find(entry => entry.id === spec.recipe)
  assert.ok(catalogue, `${spec.recipe} is not an active catalogue recipe`)
  assert.equal(catalogue.outfit, recipe.outfit)
  assert.equal(catalogue.bagStyle, recipe.bagStyle)
  assert.equal(catalogue.garmentShape, recipe.garmentShape)
  assert.equal(recipe.sourceSha256, approved.sourceSha256)
  assert.equal(recipe.recipeSha256, approved.recipeSha256)

  const built = buildGeometry(recipe, spec.detail)
  built.geometry.userData.used = built.used

  wardrobe.set(recipe.outfit, recipe.bagStyle)
  character.body.updateMatrixWorld(true)
  if (!authoredCache.has(recipe.id)) authoredCache.set(recipe.id, authoredMaterials())
  const authored = authoredCache.get(recipe.id)
  const expectedRegions = authoredRegionCheck(recipe, built, authored)
  const sourceVertexError = spec.detail === 'full' && recipe.id === 'soft-male-commuter-daypack'
    ? authoredGeometryCheck(recipe, built, authored)
    : 0
  sharedWorst.sourceVertex = Math.max(sharedWorst.sourceVertex, sourceVertexError)

  const clipKey = `${spec.fit}|${character.carry?.side ?? 0}|${character.carry && ['handbag', 'purse'].includes(character.carry.type) ? 'held' : 'free'}`
  if (!sharedClips) sharedClips = buildSharedClips()
  if (!activitySets.has(clipKey)) activitySets.set(clipKey, buildActivityClips(spec.fit))
  const activitySet = activitySets.get(clipKey)
  const { activityMatrixMaxError } = activitySet
  const clips = [...sharedClips, ...activitySet.clips]
  assert.equal(clips.length, 49, `${spec.id}: unexpected clip count`)

  // Compare the exported standing/walk clips with the game's baked atlas frames
  // for *this* recipe. Activities are compared through the replay of the bake's
  // own pose code and its skinning-matrix palette in activityPose().
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
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  writeFileSync(join(out, spec.file), bytes)
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  writeFileSync(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings. See ${reportName}`)

  const bounds = built.geometry.boundingBox
  const manifest = {
    schemaVersion: 1,
    family: 'crowd',
    id: spec.id,
    prefab: spec.prefab,
    file: spec.file,
    role: spec.role,
    recipe: spec.recipe,
    outfit: recipe.outfit,
    character: recipe.character,
    hair: recipe.hair,
    bag: recipe.bagStyle,
    garmentShape: recipe.garmentShape,
    detail: spec.detail,
    fit: spec.fit,
    handModes: spec.hands,
    scale: spec.scale,
    label: spec.label,
    rights: 'INTERNAL_REVIEW_ONLY',
    units: 'metres',
    baseHeightMetres: approved.height,
    triangles: built.triangles,
    vertices: built.vertices,
    materials: built.groups.map(group => ({
      name: `crowd-region-${String(group.index).padStart(2, '0')}-${regionColor(group.index).slice(1)}`,
      color: regionColor(group.index),
      region: group.index,
      triangles: group.triangles,
    })),
    authoredRegionColors: expectedRegions,
    bounds: {
      min: bounds.min.toArray().map(value => +value.toFixed(5)),
      max: bounds.max.toArray().map(value => +value.toFixed(5)),
      size: bounds.getSize(new T.Vector3()).toArray().map(value => +value.toFixed(5)),
    },
    clips: clips.map(clip => ({
      name: clip.name,
      duration: +clip.duration.toFixed(5),
      keys: clip.frames.length,
      samples: clip.samples,
    })),
    low: {
      triangles: recipe.lowTriangles,
      ratio: +(recipe.lowTriangles / recipe.triangles).toFixed(5),
      sharedVertexPool: true,
    },
    comparison: {
      activityMatrixMaxError: +activityMatrixMaxError.toExponential(2),
      idleFrameMaxMetres: +idleFrameMax.toFixed(6),
      walkFrameMaxMetres: +walkFrameMax.toFixed(6),
      heldAccessoryMaxMetres: +heldBagMax.toFixed(6),
      heldAccessory: heldBagMax > 0 ? 'rigid forearm weight; the bake animates the handbag carry counter-rotation per frame' : '',
      authoredSourceVertexMaxMetres: sourceVertexError,
    },
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos },
  }
  writeFileSync(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${built.triangles}t/${built.vertices}v ${built.materials.length} regions ` +
    `${clips.length} clips ${spec.detail} fit=${spec.fit} ${bytes.length} bytes ` +
    `walk=${walkFrameMax.toFixed(5)}m idle=${idleFrameMax.toFixed(5)}m held=${heldBagMax.toFixed(3)}m ` +
    `activity=${activityMatrixMaxError.toExponential(1)}`)
}

// The Low table must be a subset of the same baked vertex pool as the full mesh.
const fullRecipe = approved.library.find(entry => entry.id === 'soft-male-commuter-daypack')
const fullRow = approved.library.indexOf(fullRecipe)
const fullSet = new Set(indices.subarray(fullRow * approved.corners, fullRow * approved.corners + fullRecipe.triangles * 3))
const lowSet = new Set(lowIndices.subarray(fullRow * approved.lowCorners, fullRow * approved.lowCorners + fullRecipe.lowTriangles * 3))
for (const vertex of lowSet) assert.ok(fullSet.has(vertex), `Low topology references baked vertex ${vertex} outside the full recipe`)
assert.ok(lowSet.size <= fullSet.size)

const summary = {
  schemaVersion: 1,
  family: 'crowd',
  rights: {
    status: 'INTERNAL_REVIEW_ONLY',
    source: 'model/public' + SOFT_BASE_URL,
    license: 'The supplied readme describes a cleaned Human: Fall Flat game extract and supplies no redistribution licence.',
    production: 'BLOCKED — passenger-production-rig stays blocked until the base and its derivatives are cleared for redistribution.',
    note: 'Review-only parity fixtures for internal evaluation. Do not publish or ship this crowd.',
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
    recipeCount: approved.library.length,
    boneCount: activities.boneCount,
    fitCount: activities.fits.length,
    sampleCount: activities.samples,
    walkFrames: approved.walkFrames,
    frames: approved.frames,
    paletteCount: approved.paletteRGB.length,
    baseHeightMetres: approved.height,
    meshHeightMetres: +assets[0].bounds.size[1].toFixed(5),
    fits: activities.fits,
    handModes: activities.handModes,
    activities: activities.activities,
    boneNames: jointOrder,
    bakeBoneNames: boneNames,
    jointRootIndex: 0,
    bakeRootIndex: activities.rootBone,
    armJointIndices: jointOrder.flatMap((name, index) => /Arm|Forearm/.test(name) ? [index] : []),
    clips: assets[0].clips.map(clip => clip.name),
    clipDurations: assets[0].clips.map(clip => clip.duration),
    walkProfiles: approved.walkProfiles,
    rig: 'soft-human selected FBX base: 15 source bones rebased with a Hips root — 16 joints, source skin weights, baked palette regions',
    skinning: 'The bake stores the source four-influence weights; every exported vertex sums to 1 and keeps its source joints',
    geometry: 'One skinned mesh per recipe rebuilt from the active bake bind pool; the exact baked full or Low index table is used',
    animation: 'The bake stores GPU skinning matrices for 8 height fits, 3 hand modes, 15 activities and 3 walks; this export inverts them to local joint tracks and grounds the standing/walk clips exactly as the atlas does',
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
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`CROWD_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED source=${sourceSha256.slice(0, 12)} recipe=${approved.recipeSha256.slice(0, 12)}`)
console.log(`CROWD_EXPORT_OK ${assets.length} recipes from the active bake, ${summary.parameters.clips.length} clips each, ` +
  `${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
