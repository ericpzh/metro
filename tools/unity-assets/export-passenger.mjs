import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import validator from 'gltf-validator'

// The passenger (乘客) family: a deliberately simple, clearly original humanoid
// stand-in for the Unity migration. Nothing here derives from HumanBody_Alt.fbx,
// the baked soft-human atlases or any third-party model: every vertex is built
// from three.js primitives in this file, every material is a flat authored
// colour, and the 15-bone skeleton is named for this asset alone.
//
// Four assets cover the family rows:
//   passenger-adult  1.70 m, navy top / grey trousers, cap hair, shoulder bag
//   passenger-child  1.20 m, orange top / indigo trousers, bob hair
//   passenger-jacket 1.70 m, teal top / charcoal trousers, ponytail, shoulder bag
//   passenger-low    1.70 m, the adult palette at low detail (near/far LOD pair)
//
// Every asset carries the same eight clips (Idle, Walk, Stairs, Escalator,
// Board, Seated, Ticket, Bench), the same named attachment points, and four
// normalised skin influences per vertex. The leg keyframes are auto-grounded:
// each key lowers/raises the hips until the lowest sole sits on y = 0, so the
// walk always has a planted foot.
//
// The GLB is exported Y-up with the feet on y = 0 and the figure facing +Z. No
// export rotation or Unity basis wrapper is used; glTFast negates X on import,
// which the review script compensates for when it compares sampled poses.

const ADULT_HEIGHT = 1.7
const CHILD_HEIGHT = 1.2

// Local rest offsets (metres at 1.70 m). Head sits at 1.52 m; its geometry is
// placed so the crown reaches exactly the asset height.
const BONES = [
  { name: 'Hips', parent: null, offset: [0, 0.9, 0] },
  { name: 'Spine', parent: 'Hips', offset: [0, 0.15, 0] },
  { name: 'Chest', parent: 'Spine', offset: [0, 0.2, 0] },
  { name: 'Neck', parent: 'Chest', offset: [0, 0.17, 0] },
  { name: 'Head', parent: 'Neck', offset: [0, 0.1, 0] },
  { name: 'UpperArm.L', parent: 'Chest', offset: [0.21, -0.02, 0] },
  { name: 'LowerArm.L', parent: 'UpperArm.L', offset: [0, -0.28, 0] },
  { name: 'UpperArm.R', parent: 'Chest', offset: [-0.21, -0.02, 0] },
  { name: 'LowerArm.R', parent: 'UpperArm.R', offset: [0, -0.28, 0] },
  { name: 'UpperLeg.L', parent: 'Hips', offset: [0.1, -0.06, 0] },
  { name: 'LowerLeg.L', parent: 'UpperLeg.L', offset: [0, -0.42, 0] },
  { name: 'Foot.L', parent: 'LowerLeg.L', offset: [0, -0.38, 0.02] },
  { name: 'UpperLeg.R', parent: 'Hips', offset: [-0.1, -0.06, 0] },
  { name: 'LowerLeg.R', parent: 'UpperLeg.R', offset: [0, -0.42, 0] },
  { name: 'Foot.R', parent: 'LowerLeg.R', offset: [0, -0.38, 0.02] },
]
const BONE_NAMES = BONES.map(bone => bone.name)

const WARDROBES = {
  navy: { wardrobe: '#2f5aa8', trousers: '#3a3d43', skin: '#c99572', shoes: '#24262a', hair: '#241b16', bag: '#a06a33', strap: '#6f4a22' },
  orange: { wardrobe: '#c2571f', trousers: '#2b3a5a', skin: '#c99572', shoes: '#24262a', hair: '#3a2a1e', bag: '#a06a33', strap: '#6f4a22' },
  teal: { wardrobe: '#147a6b', trousers: '#4a4f57', skin: '#c99572', shoes: '#24262a', hair: '#1d1a17', bag: '#a06a33', strap: '#6f4a22' },
}

const MODELS = [
  {
    id: 'passenger.adult', prefab: 'PassengerAdult', file: 'passenger-adult.glb', role: 'adult',
    height: ADULT_HEIGHT, low: false, wardrobe: 'navy', hair: 'cap', bag: true,
    label: '1.70 m adult, navy top, cap hair, shoulder bag',
  },
  {
    id: 'passenger.child', prefab: 'PassengerChild', file: 'passenger-child.glb', role: 'child',
    height: CHILD_HEIGHT, low: false, wardrobe: 'orange', hair: 'bob', bag: false,
    label: '1.20 m child, orange top, bob hair',
  },
  {
    id: 'passenger.jacket', prefab: 'PassengerJacket', file: 'passenger-jacket.glb', role: 'adult',
    height: ADULT_HEIGHT, low: false, wardrobe: 'teal', hair: 'ponytail', bag: true,
    label: '1.70 m adult, teal top, ponytail, shoulder bag',
  },
  {
    id: 'passenger.low', prefab: 'PassengerLow', file: 'passenger-low.glb', role: 'adult-low',
    height: ADULT_HEIGHT, low: true, wardrobe: 'navy', hair: 'cap', bag: true,
    scaleVariantOf: 'passenger.adult',
    label: '1.70 m low-detail LOD of the adult',
  },
]

// Original humanoid stand-in clips. Rotations are local XYZ Euler degrees; the
// hips translation is resolved by grounding the lowest sole on y = 0.
const CLIP_SPECS = [
  {
    name: 'Idle', duration: 2, keys: [
      { at: 0, bones: {} },
      { at: 1, bones: { Chest: [0, 0, 1.2], Head: [0, 2.5, 0], 'UpperArm.L': [1.5, 0, -1], 'UpperArm.R': [1.5, 0, 1] } },
      { at: 2, bones: {} },
    ],
  },
  {
    name: 'Walk', duration: 1, keys: [
      { at: 0, bones: { 'UpperLeg.L': [-24, 0, 0], 'LowerLeg.L': [4, 0, 0], 'Foot.L': [14, 0, 0], 'UpperLeg.R': [18, 0, 0], 'LowerLeg.R': [4, 0, 0], 'Foot.R': [-10, 0, 0], 'UpperArm.L': [18, 0, 2], 'UpperArm.R': [-18, 0, -2], 'LowerArm.L': [12, 0, 0], 'LowerArm.R': [20, 0, 0], Chest: [2, 0, 0] } },
      { at: 0.25, bones: { 'UpperLeg.L': [-4, 0, 0], 'LowerLeg.L': [8, 0, 0], 'Foot.L': [4, 0, 0], 'UpperLeg.R': [-10, 0, 0], 'LowerLeg.R': [42, 0, 0], 'Foot.R': [8, 0, 0], 'UpperArm.L': [4, 0, 2], 'UpperArm.R': [-4, 0, -2], 'LowerArm.L': [10, 0, 0], 'LowerArm.R': [14, 0, 0], Chest: [2, 0, 0] } },
      { at: 0.5, bones: { 'UpperLeg.R': [-24, 0, 0], 'LowerLeg.R': [4, 0, 0], 'Foot.R': [14, 0, 0], 'UpperLeg.L': [18, 0, 0], 'LowerLeg.L': [4, 0, 0], 'Foot.L': [-10, 0, 0], 'UpperArm.R': [18, 0, -2], 'UpperArm.L': [-18, 0, 2], 'LowerArm.R': [12, 0, 0], 'LowerArm.L': [20, 0, 0], Chest: [2, 0, 0] } },
      { at: 0.75, bones: { 'UpperLeg.R': [-4, 0, 0], 'LowerLeg.R': [8, 0, 0], 'Foot.R': [4, 0, 0], 'UpperLeg.L': [-10, 0, 0], 'LowerLeg.L': [42, 0, 0], 'Foot.L': [8, 0, 0], 'UpperArm.R': [4, 0, -2], 'UpperArm.L': [-4, 0, 2], 'LowerArm.R': [10, 0, 0], 'LowerArm.L': [14, 0, 0], Chest: [2, 0, 0] } },
      { at: 1, bones: { 'UpperLeg.L': [-24, 0, 0], 'LowerLeg.L': [4, 0, 0], 'Foot.L': [14, 0, 0], 'UpperLeg.R': [18, 0, 0], 'LowerLeg.R': [4, 0, 0], 'Foot.R': [-10, 0, 0], 'UpperArm.L': [18, 0, 2], 'UpperArm.R': [-18, 0, -2], 'LowerArm.L': [12, 0, 0], 'LowerArm.R': [20, 0, 0], Chest: [2, 0, 0] } },
    ],
  },
  {
    name: 'Stairs', duration: 1.2, keys: [
      { at: 0, bones: { 'UpperLeg.L': [-38, 0, 0], 'LowerLeg.L': [60, 0, 0], 'Foot.L': [10, 0, 0], 'UpperLeg.R': [10, 0, 0], 'LowerLeg.R': [8, 0, 0], 'Foot.R': [-5, 0, 0], 'UpperArm.L': [14, 0, 2], 'UpperArm.R': [-14, 0, -2], Chest: [6, 0, 0] } },
      { at: 0.3, bones: { 'UpperLeg.L': [-8, 0, 0], 'LowerLeg.L': [30, 0, 0], 'Foot.L': [6, 0, 0], 'UpperLeg.R': [-20, 0, 0], 'LowerLeg.R': [50, 0, 0], 'Foot.R': [10, 0, 0], 'UpperArm.L': [6, 0, 2], 'UpperArm.R': [-6, 0, -2], Chest: [6, 0, 0] } },
      { at: 0.6, bones: { 'UpperLeg.R': [-38, 0, 0], 'LowerLeg.R': [60, 0, 0], 'Foot.R': [10, 0, 0], 'UpperLeg.L': [10, 0, 0], 'LowerLeg.L': [8, 0, 0], 'Foot.L': [-5, 0, 0], 'UpperArm.R': [14, 0, -2], 'UpperArm.L': [-14, 0, 2], Chest: [6, 0, 0] } },
      { at: 0.9, bones: { 'UpperLeg.R': [-8, 0, 0], 'LowerLeg.R': [30, 0, 0], 'Foot.R': [6, 0, 0], 'UpperLeg.L': [-20, 0, 0], 'LowerLeg.L': [50, 0, 0], 'Foot.L': [10, 0, 0], 'UpperArm.R': [6, 0, -2], 'UpperArm.L': [-6, 0, 2], Chest: [6, 0, 0] } },
      { at: 1.2, bones: { 'UpperLeg.L': [-38, 0, 0], 'LowerLeg.L': [60, 0, 0], 'Foot.L': [10, 0, 0], 'UpperLeg.R': [10, 0, 0], 'LowerLeg.R': [8, 0, 0], 'Foot.R': [-5, 0, 0], 'UpperArm.L': [14, 0, 2], 'UpperArm.R': [-14, 0, -2], Chest: [6, 0, 0] } },
    ],
  },
  {
    name: 'Escalator', duration: 2.4, keys: [
      { at: 0, bones: { 'UpperArm.R': [-38, 0, -6], 'LowerArm.R': [-12, 0, 0], 'UpperArm.L': [2, 0, 3], 'LowerArm.L': [6, 0, 0], Chest: [0, 0, 1] } },
      { at: 1.2, bones: { 'UpperArm.R': [-40, 0, -6], 'LowerArm.R': [-14, 0, 0], 'UpperArm.L': [2, 0, 3], 'LowerArm.L': [6, 0, 0], Chest: [0, 0, 1.8], Head: [0, 2, 0] } },
      { at: 2.4, bones: { 'UpperArm.R': [-38, 0, -6], 'LowerArm.R': [-12, 0, 0], 'UpperArm.L': [2, 0, 3], 'LowerArm.L': [6, 0, 0], Chest: [0, 0, 1] } },
    ],
  },
  {
    name: 'Board', duration: 1.4, keys: [
      { at: 0, bones: {} },
      { at: 0.35, bones: { 'UpperLeg.R': [-32, 0, 0], 'LowerLeg.R': [45, 0, 0], 'Foot.R': [10, 0, 0], 'UpperLeg.L': [6, 0, 0], 'LowerLeg.L': [4, 0, 0], 'UpperArm.L': [-16, 0, 3], 'UpperArm.R': [-16, 0, -3], 'LowerArm.L': [12, 0, 0], 'LowerArm.R': [12, 0, 0], Chest: [7, 0, 0], Head: [3, 0, 0] } },
      { at: 0.7, bones: { 'UpperLeg.R': [-10, 0, 0], 'LowerLeg.R': [6, 0, 0], 'Foot.R': [3, 0, 0], 'UpperLeg.L': [4, 0, 0], 'LowerArm.L': [6, 0, 0], 'LowerArm.R': [6, 0, 0], 'UpperArm.L': [-6, 0, 2], 'UpperArm.R': [-6, 0, -2], Chest: [4, 0, 0], Head: [2, 0, 0] } },
      { at: 1.05, bones: { 'UpperLeg.R': [2, 0, 0], 'LowerLeg.R': [2, 0, 0], Chest: [1, 0, 0] } },
      { at: 1.4, bones: {} },
    ],
  },
  {
    name: 'Seated', duration: 2, keys: [
      { at: 0, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [4, 0, 0], Chest: [2, 0, 0], 'UpperArm.L': [-8, 0, 6], 'UpperArm.R': [-8, 0, -6], 'LowerArm.L': [-30, 0, 0], 'LowerArm.R': [-30, 0, 0] } },
      { at: 1, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [4, 0, 0], Chest: [3, 0, 1], Head: [0, 1, 0], 'UpperArm.L': [-8, 0, 6], 'UpperArm.R': [-8, 0, -6], 'LowerArm.L': [-30, 0, 0], 'LowerArm.R': [-30, 0, 0] } },
      { at: 2, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [4, 0, 0], Chest: [2, 0, 0], 'UpperArm.L': [-8, 0, 6], 'UpperArm.R': [-8, 0, -6], 'LowerArm.L': [-30, 0, 0], 'LowerArm.R': [-30, 0, 0] } },
    ],
  },
  {
    name: 'Ticket', duration: 2, keys: [
      { at: 0, bones: {} },
      { at: 0.7, bones: { 'UpperArm.R': [-68, 0, -8], 'LowerArm.R': [-22, 0, 0], 'UpperArm.L': [2, 0, 2], Chest: [5, 0, -1], Head: [7, 0, 5] } },
      { at: 1.4, bones: { 'UpperArm.R': [-62, 0, -8], 'LowerArm.R': [-26, 0, 0], 'UpperArm.L': [2, 0, 2], Chest: [4, 0, -1], Head: [5, 0, 3] } },
      { at: 2, bones: {} },
    ],
  },
  {
    name: 'Bench', duration: 2, keys: [
      { at: 0, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [6, 0, 0], Chest: [2, 0, 0], 'UpperArm.L': [-22, 0, 5], 'UpperArm.R': [-22, 0, -5], 'LowerArm.L': [-52, 0, 0], 'LowerArm.R': [-52, 0, 0] } },
      { at: 1, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [6, 0, 0], Chest: [2, 0, 0], 'UpperArm.L': [-24, 0, 5], 'UpperArm.R': [-24, 0, -5], 'LowerArm.L': [-54, 0, 0], 'LowerArm.R': [-54, 0, 0], Head: [0, 1.5, 0] } },
      { at: 2, bones: { 'UpperLeg.L': [-85, 0, 0], 'LowerLeg.L': [85, 0, 0], 'UpperLeg.R': [-85, 0, 0], 'LowerLeg.R': [85, 0, 0], Spine: [6, 0, 0], Chest: [2, 0, 0], 'UpperArm.L': [-22, 0, 5], 'UpperArm.R': [-22, 0, -5], 'LowerArm.L': [-52, 0, 0], 'LowerArm.R': [-52, 0, 0] } },
    ],
  },
]
const CLIP_NAMES = CLIP_SPECS.map(clip => clip.name)

// Headless GLTFExporter needs a FileReader to turn its GLB blob into bytes.
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

const smoothstep = value => {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

/** Two-weight blend down a named bone chain; the chain is ordered head to toe. */
function chainWeights(chain, y) {
  if (y >= chain[0].y) return [[chain[0].bone, 1]]
  for (let i = 0; i < chain.length - 1; i++) {
    const upper = chain[i], lower = chain[i + 1]
    if (y <= upper.y && y >= lower.y) {
      const t = smoothstep((upper.y - y) / (upper.y - lower.y))
      return t <= 1e-6 ? [[upper.bone, 1]] : t >= 1 - 1e-6 ? [[lower.bone, 1]] : [[upper.bone, 1 - t], [lower.bone, t]]
    }
  }
  return [[chain[chain.length - 1].bone, 1]]
}

function place(geometry, x, y, z, rotate = null, scale = null) {
  if (scale) geometry.scale(scale[0], scale[1], scale[2])
  if (rotate) {
    if (rotate[0]) geometry.rotateX(rotate[0])
    if (rotate[1]) geometry.rotateY(rotate[1])
    if (rotate[2]) geometry.rotateZ(rotate[2])
  }
  geometry.translate(x, y, z)
  return geometry
}

function capsule(r, length, radial, caps) {
  const geometry = new THREE.CapsuleGeometry(r, length, caps, radial)
  geometry.deleteAttribute('uv')
  return geometry
}

function box(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  geometry.deleteAttribute('uv')
  return geometry
}

function sphere(r, widthSegments, heightSegments, thetaLength = Math.PI) {
  const geometry = new THREE.SphereGeometry(r, widthSegments, heightSegments, 0, Math.PI * 2, 0, thetaLength)
  geometry.deleteAttribute('uv')
  return geometry
}

function cylinder(radiusTop, radiusBottom, height, radial) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial, 1)
  geometry.deleteAttribute('uv')
  return geometry
}

function degreesToQuaternion(degrees) {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(degrees[0] ?? 0),
    THREE.MathUtils.degToRad(degrees[1] ?? 0),
    THREE.MathUtils.degToRad(degrees[2] ?? 0),
    'XYZ')
  return new THREE.Quaternion().setFromEuler(euler)
}

function buildPassenger(spec) {
  const scale = spec.height / ADULT_HEIGHT
  const low = spec.low
  const childHead = spec.role === 'child' ? 1.18 : 1
  const palette = WARDROBES[spec.wardrobe]
  const wardrobeName = spec.wardrobe

  // World-space rest positions for the weight chains.
  const world = new Map()
  for (const bone of BONES) {
    const parent = bone.parent ? world.get(bone.parent) : [0, 0, 0]
    world.set(bone.name, [
      parent[0] + bone.offset[0] * scale,
      parent[1] + bone.offset[1] * scale,
      parent[2] + bone.offset[2] * scale,
    ])
  }
  const boneIndex = new Map(BONE_NAMES.map((name, index) => [name, index]))
  const chain = names => names.map(name => ({ bone: boneIndex.get(name), y: world.get(name)[1] }))

  const scene = new THREE.Scene()
  scene.name = spec.prefab

  const boneByName = new Map()
  const bones = []
  for (const definition of BONES) {
    const bone = new THREE.Bone()
    bone.name = definition.name
    bone.position.set(definition.offset[0] * scale, definition.offset[1] * scale, definition.offset[2] * scale)
    bones.push(bone)
    boneByName.set(definition.name, bone)
    if (definition.parent) boneByName.get(definition.parent).add(bone)
    else scene.add(bone)
  }

  // Named attachment points inside the rig, so fixture clips can target a
  // wrist or the seat without a per-asset wrapper override.
  const anchorSpecs = [
    ['Attach.Hand.R', 'LowerArm.R', [0, -0.3 * scale, 0]],
    ['Attach.Hand.L', 'LowerArm.L', [0, -0.3 * scale, 0]],
    ['Attach.Seat', 'Hips', [0, -0.06 * scale, 0]],
    ['Attach.Head', 'Head', [0, 0.12 * scale, 0]],
  ]
  const anchors = []
  for (const [name, boneName, local] of anchorSpecs) {
    const node = new THREE.Object3D()
    node.name = name
    node.position.set(local[0], local[1], local[2])
    boneByName.get(boneName).add(node)
    anchors.push({ name, bone: boneName, localPosition: local })
  }

  scene.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)

  const radial = low ? 5 : 10
  const caps = low ? 2 : 4
  const sphereWidth = low ? 6 : 10
  const sphereHeight = low ? 4 : 7

  const headRx = 0.098 * scale * childHead
  const headRy = 0.112 * scale * childHead
  const headRz = 0.105 * scale * childHead
  const headCenter = spec.height - headRy

  // Group geometry by the authored material recipe.
  const parts = { skin: [], wardrobe: [], trousers: [], shoes: [], hair: [], bag: [], strap: [] }
  const add = (part, geometry, weights) => parts[part].push({ geometry, weights })

  // Spine chain for the torso, hips and neck.
  const torsoChain = chain(['Chest', 'Spine', 'Hips'])
  const hipsChain = chain(['Spine', 'Hips'])
  const neckChain = chain(['Head', 'Neck', 'Chest'])
  const headChain = chain(['Head'])
  const bagChain = chain(['Chest', 'Spine', 'Hips'])

  add('trousers', place(capsule(0.125 * scale, 0.1 * scale, radial, caps), 0, 0.93 * scale, 0, null, [1.15, 1, 0.85]), hipsChain)
  add('wardrobe', place(capsule(0.155 * scale, 0.16 * scale, radial, caps), 0, 1.21 * scale, 0, null, [1.12, 1, 0.72]), torsoChain)
  add('skin', place(cylinder(0.045 * scale, 0.05 * scale, 0.1 * scale, radial), 0, 1.44 * scale, 0), neckChain)
  add('skin', place(sphere(1, sphereWidth, sphereHeight), 0, headCenter, 0, null, [headRx, headRy, headRz]), headChain)
  add('skin', place(box(0.018 * scale * childHead, 0.026 * scale * childHead, 0.03 * scale * childHead), 0, headCenter - 0.018 * scale, headRz * 0.94), headChain)

  for (const side of ['L', 'R']) {
    const x = (side === 'L' ? 1 : -1) * 0.21 * scale
    const upperArmChain = chain(['Chest', `UpperArm.${side}`, `LowerArm.${side}`])
    const lowerArmChain = chain([`UpperArm.${side}`, `LowerArm.${side}`])
    const handChain = chain([`LowerArm.${side}`])
    add('wardrobe', place(capsule(0.052 * scale, 0.176 * scale, radial, caps), x, 1.09 * scale, 0), upperArmChain)
    add('skin', place(capsule(0.043 * scale, 0.174 * scale, radial, caps), x, 0.82 * scale, 0), lowerArmChain)
    add('skin', place(sphere(0.048 * scale, sphereWidth, Math.max(4, sphereHeight - 1)), x, 0.665 * scale, 0.005 * scale), handChain)
  }

  for (const side of ['L', 'R']) {
    const x = (side === 'L' ? 1 : -1) * 0.1 * scale
    const upperLegChain = chain(['Hips', `UpperLeg.${side}`, `LowerLeg.${side}`])
    const lowerLegChain = chain([`UpperLeg.${side}`, `LowerLeg.${side}`, `Foot.${side}`])
    const footChain = chain([`LowerLeg.${side}`, `Foot.${side}`])
    add('trousers', place(capsule(0.072 * scale, 0.276 * scale, radial, caps), x, 0.63 * scale, 0), upperLegChain)
    add('trousers', place(capsule(0.058 * scale, 0.264 * scale, radial, caps), x, 0.23 * scale, 0), lowerLegChain)
    add('shoes', place(box(0.1 * scale, 0.075 * scale, 0.24 * scale), x, 0.0375 * scale, 0.06 * scale), footChain)
  }

  // Hair: a cap for the adult/low, a bob for the child, a short ponytail for the
  // jacket variant. Low detail keeps the simplest cap so the far silhouette
  // still reads as a head. The cap stays inside the crown so the asset height
  // is exactly the authored height.
  add('hair', place(sphere(1, sphereWidth, sphereHeight, Math.PI * 0.6), 0, headCenter, 0, null,
    [headRx * 1.06, headRy, headRz * 1.07]), headChain)
  if (!low && spec.hair === 'bob') {
    for (const side of ['L', 'R']) {
      add('hair', place(box(0.028 * scale, 0.11 * scale, 0.085 * scale),
        (side === 'L' ? 1 : -1) * headRx * 0.92, headCenter - headRy * 0.35, -0.01 * scale), headChain)
    }
    add('hair', place(box(headRx * 1.5, 0.1 * scale, 0.035 * scale), 0, headCenter - headRy * 0.15, -headRz * 0.85), headChain)
  }
  if (!low && spec.hair === 'ponytail') {
    add('hair', place(box(0.045 * scale, 0.16 * scale, 0.045 * scale), 0, headCenter - 0.055 * scale, -headRz * 1.15, [0.2, 0, 0]), headChain)
  }

  // One strap/bag accessory: a diagonal chest strap and a bag at the opposite
  // hip, weighted across the spine so it follows the torso.
  if (spec.bag) {
    add('bag', place(box(0.15 * scale, 0.18 * scale, 0.07 * scale), -0.2 * scale, 0.95 * scale, 0.035 * scale), bagChain)
    add('strap', place(box(0.04 * scale, 0.5 * scale, 0.018 * scale), 0.005 * scale, 1.2 * scale, 0.125 * scale, [0, 0, THREE.MathUtils.degToRad(40)]), bagChain)
  }

  let vertexCount = 0
  let triangleCount = 0
  const meshes = []
  const materialNames = []
  for (const [part, list] of Object.entries(parts)) {
    if (list.length === 0) continue
    for (const { geometry, weights } of list) {
      assert.ok(geometry.index, `${spec.prefab}: ${part} geometry is not indexed`)
      const position = geometry.getAttribute('position')
      const skinIndex = [], skinWeight = []
      for (let i = 0; i < position.count; i++) {
        const influences = chainWeights(weights, position.getY(i))
        const index = [0, 0, 0, 0], weight = [0, 0, 0, 0]
        influences.forEach(([joint, value], slot) => { index[slot] = joint; weight[slot] = value })
        skinIndex.push(...index)
        skinWeight.push(...weight)
      }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
      vertexCount += position.count
      triangleCount += geometry.index.count / 3
    }
    const geometry = list.length === 1 ? list[0].geometry : mergeGeometries(list.map(entry => entry.geometry), false)
    assert.ok(geometry, `${spec.prefab}: could not merge ${part} geometry`)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    const material = new THREE.MeshStandardMaterial({
      name: part === 'wardrobe' ? `wardrobe_${wardrobeName}` : part === 'trousers' ? `trousers_${spec.wardrobe === 'navy' ? 'grey' : spec.wardrobe === 'orange' ? 'indigo' : 'charcoal'}` : part === 'hair' ? `hair_${spec.hair === 'bob' ? 'brown' : spec.hair === 'ponytail' ? 'black' : 'dark'}` : part,
      color: new THREE.Color(palette[part]),
      roughness: 0.85,
      metalness: 0,
    })
    const mesh = new THREE.SkinnedMesh(geometry, material)
    mesh.name = part
    scene.add(mesh)
    meshes.push(mesh)
    materialNames.push(material.name)
  }

  scene.updateMatrixWorld(true)
  for (const mesh of meshes) mesh.bind(skeleton)
  scene.updateMatrixWorld(true)

  const boundsBox = new THREE.Box3().setFromObject(scene)
  const bounds = {
    min: boundsBox.min.toArray(),
    max: boundsBox.max.toArray(),
    size: boundsBox.getSize(new THREE.Vector3()).toArray(),
  }
  assert.ok(Math.abs(bounds.size[1] - spec.height) < 0.002, `${spec.prefab}: height ${bounds.size[1]} != ${spec.height}`)
  assert.ok(Math.abs(bounds.min[1]) < 0.002, `${spec.prefab}: feet are not on y = 0 (${bounds.min[1]})`)

  const ankleHeight = 0.04 * scale
  const hipsBase = world.get('Hips')[1]
  const footBones = ['Foot.L', 'Foot.R']

  const applyPose = (pose, hips) => {
    for (const name of BONE_NAMES) boneByName.get(name).quaternion.copy(degreesToQuaternion(pose[name] ?? [0, 0, 0]))
    boneByName.get('Hips').position.set(hips[0], hips[1], hips[2])
    scene.updateMatrixWorld(true)
  }
  const sole = name => {
    const position = boneByName.get(name).getWorldPosition(new THREE.Vector3())
    return position.y - ankleHeight
  }
  const lowestSole = () => Math.min(...footBones.map(sole))
  const worldPosition = object => object.getWorldPosition(new THREE.Vector3()).toArray().map(value => +value.toFixed(5))

  // Resolve each key: apply the rotations, then lower the hips until the lowest
  // sole rests on the floor. This gives every clip a planted foot.
  const clips = []
  for (const definition of CLIP_SPECS) {
    const end = definition.duration
    assert.ok(Math.abs(definition.keys[definition.keys.length - 1].at - end) < 1e-6,
      `${definition.name}: last key ${definition.keys[definition.keys.length - 1].at} != duration ${end}`)
    const resolvedKeys = definition.keys.map(key => {
      const pose = { ...key.bones }
      applyPose(pose, [0, hipsBase, 0])
      const offset = -lowestSole()
      return { at: key.at, pose, hips: [0, +(hipsBase + offset).toFixed(5), 0], offset: +offset.toFixed(5) }
    })
    const first = resolvedKeys[0], last = resolvedKeys[resolvedKeys.length - 1]
    assert.equal(JSON.stringify(first.pose), JSON.stringify(last.pose), `${definition.name}: loop start/end pose differs`)
    assert.ok(Math.abs(first.hips[1] - last.hips[1]) < 1e-6, `${definition.name}: loop start/end hips differ`)

    // A clip that never moves a bone is not an animation.
    const moved = BONE_NAMES.some(name => resolvedKeys.some(key => key.pose[name] && key.pose[name].some(value => Math.abs(value) > 0.5)))
    assert.ok(moved, `${definition.name}: no bone rotates`)

    const times = resolvedKeys.map(key => key.at)
    const tracks = []
    for (const name of BONE_NAMES) {
      const values = []
      for (const key of resolvedKeys) {
        const quaternion = degreesToQuaternion(key.pose[name] ?? [0, 0, 0])
        values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values))
    }
    const hipsValues = []
    for (const key of resolvedKeys) hipsValues.push(key.hips[0], key.hips[1], key.hips[2])
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsValues))

    // Sample every key for the Unity parity check and the contact evidence.
    const samples = []
    for (const key of resolvedKeys) {
      applyPose(key.pose, key.hips)
      const soleNow = lowestSole()
      assert.ok(soleNow > -0.003 && soleNow < 0.02, `${definition.name}: key ${key.at} misses the floor (${soleNow})`)
      const feet = footBones.map(name => ({ name, sole: +sole(name).toFixed(4) }))
      samples.push({
        time: key.at,
        hips: key.hips,
        lowestSole: +soleNow.toFixed(4),
        feet,
        bones: BONE_NAMES.map(name => ({ name, position: worldPosition(boneByName.get(name)) })),
        attachments: anchors.map(anchor => ({ name: anchor.name, position: worldPosition(boneAnchor(anchor.name)) })),
      })
    }
    if (definition.name === 'Walk') {
      // Auto-grounding keeps the lowest sole on the floor; prove the other foot
      // actually swings clear so the clip reads as a walk, not a shuffle.
      const swing = Math.max(...samples.map(sample => Math.max(...sample.feet.map(foot => foot.sole))))
      assert.ok(swing > 0.03, `Walk: no foot lifts clear of the floor (${swing})`)
      assert.ok(samples.every(sample => Math.min(...sample.feet.map(foot => foot.sole)) < 0.003),
        'Walk: a keyframe has no planted foot')
    }
    clips.push({
      name: definition.name,
      duration: end,
      channels: BONE_NAMES.length + 1,
      keyframes: resolvedKeys.length,
      contactTimes: definition.name === 'Walk' ? samples.filter(sample => sample.lowestSole < 0.003).map(sample => sample.time) : [],
      samples,
      track: new THREE.AnimationClip(definition.name, end, tracks),
    })
  }
  function boneAnchor(name) {
    return scene.getObjectByName(name)
  }

  // Restore the bind pose before exporting; node transforms must be the rest
  // rig, never the last sampled frame.
  applyPose({}, [0, hipsBase, 0])

  return {
    scene,
    bones,
    skeleton,
    meshes,
    clips,
    anchors,
    bounds,
    vertexCount,
    triangleCount,
    materialNames: materialNames.sort(),
    scale,
    ankleHeight,
  }
}

const out = resolve(process.argv[2] ?? '.preview/unity/passenger-proof/export')
await mkdir(out, { recursive: true })

const assets = []
for (const spec of MODELS) {
  const built = buildPassenger(spec)
  const bytes = new Uint8Array(await new GLTFExporter().parseAsync(built.scene, {
    binary: true,
    animations: built.clips.map(clip => clip.track),
  }))
  const report = await validator.validateBytes(bytes, { uri: spec.file })
  const reportName = spec.file.replace(/\.glb$/, '.validation.json')
  await writeFile(join(out, reportName), JSON.stringify(report, null, 2) + '\n')
  assert.equal(report.issues.numErrors + report.issues.numWarnings, 0,
    `${spec.file}: ${report.issues.numErrors} errors, ${report.issues.numWarnings} warnings. See ${reportName}`)
  // The four attachment points are deliberately empty nodes; the validator
  // reports those as informational NODE_EMPTY notices, which are expected.

  const manifest = {
    schemaVersion: 1,
    family: 'passenger',
    id: spec.id,
    prefab: spec.prefab,
    file: spec.file,
    role: spec.role,
    scaleVariantOf: spec.scaleVariantOf ?? null,
    label: spec.label,
    source: 'tools/unity-assets/export-passenger.mjs',
    provenance: 'Original procedural capsule/box humanoid authored for this review. No HumanBody_Alt.fbx, soft-human baked atlas, game crowd mesh, skeleton or texture, and no third-party model was used.',
    licenseRecord: 'Original repository-authored procedural geometry; no third-party assets',
    units: 'metres',
    heightMetres: spec.height,
    ankleHeightMetres: +built.ankleHeight.toFixed(5),
    triangles: built.triangleCount,
    vertices: built.vertexCount,
    meshes: built.meshes.length,
    materials: built.materialNames,
    bones: BONE_NAMES,
    boneCount: BONE_NAMES.length,
    wardrobe: { name: spec.wardrobe, top: WARDROBES[spec.wardrobe].wardrobe, trousers: WARDROBES[spec.wardrobe].trousers, skin: WARDROBES[spec.wardrobe].skin },
    hair: spec.hair,
    bag: spec.bag ? 'shoulder bag with diagonal chest strap' : 'none',
    anchors: built.anchors,
    bounds: built.bounds,
    clips: built.clips.map(clip => ({
      name: clip.name,
      duration: clip.duration,
      channels: clip.channels,
      keyframes: clip.keyframes,
      contactTimes: clip.contactTimes,
      samples: clip.samples,
    })),
    validation: { errors: report.issues.numErrors, warnings: report.issues.numWarnings, infos: report.issues.numInfos },
  }
  assert.equal(built.clips.length, CLIP_NAMES.length, `${spec.prefab}: clip count`)
  assert.deepEqual(built.clips.map(clip => clip.name), CLIP_NAMES, `${spec.prefab}: clip names`)

  await writeFile(join(out, spec.file), bytes)
  await writeFile(join(out, spec.file.replace(/\.glb$/, '.manifest.json')), JSON.stringify(manifest, null, 2) + '\n')
  assets.push(manifest)
  console.log(`${spec.id}: ${manifest.triangles} triangles, ${manifest.vertices} vertices, ${manifest.meshes} meshes, ` +
    `${manifest.clips.length} clips, ${manifest.heightMetres} m, ${bytes.length} bytes`)
}

const summary = {
  schemaVersion: 1,
  family: 'passenger',
  sourcePaths: [
    '../game/src/assets/PASSENGERS.md',
    '../game/src/render/passengerModel.ts',
    '../game/src/render/passengerActivities.ts',
    '../game/src/render/passengerAtlas.ts',
    '../game/src/render/passengerEligibility.ts',
  ],
  parameters: {
    models: MODELS.length,
    rig: 'original procedural low-poly humanoid stand-in: capsule/box body parts, 15 named bones, smooth two-joint blends padded to four normalised influences',
    provenance: 'Original repository-authored geometry and animation built directly in tools/unity-assets/export-passenger.mjs. Nothing derives from HumanBody_Alt.fbx, the baked soft-human atlases, the game crowd or a third-party model.',
    licenseRecord: 'Original procedural geometry; no third-party assets',
    boneCount: BONE_NAMES.length,
    boneNames: BONE_NAMES,
    clipNames: CLIP_NAMES,
    clipDurations: CLIP_SPECS.map(clip => clip.duration),
    baseHeightMetres: ADULT_HEIGHT,
    childHeightMetres: CHILD_HEIGHT,
    ankleHeightMetres: 0.04,
    lodFullTriangles: assets[0].triangles,
    lodLowTriangles: assets.find(asset => asset.role === 'adult-low').triangles,
    basis: 'glTF Y-up, feet on y = 0, figure faces +Z; no export rotation and no Unity basis wrapper (glTFast negates X on import; the review compares sampled poses with X reflected)',
    skinning: 'two-joint smoothstep weights per vertex along the bone chain, padded with joint 0 / weight 0; every vertex sums to 1 and no zero-weight slot names a non-zero joint',
    grounding: 'each keyframe lowers the hips until the lowest foot sole rests on y = 0; Walk contact keys are recorded in the manifest',
    wardrobe: 'navy top + grey trousers (adult/low), orange top + indigo trousers (child), teal top + charcoal trousers (jacket)',
    hair: 'cap (adult, low), bob (child), short ponytail (jacket)',
    bags: 'shoulder bag with diagonal chest strap on adult, jacket and low; none on the child',
    clipNamesByRow: [
      { row: 'passenger-idle', clip: 'Idle' },
      { row: 'passenger-walk', clip: 'Walk' },
      { row: 'passenger-stairs', clip: 'Stairs' },
      { row: 'passenger-escalator', clip: 'Escalator' },
      { row: 'passenger-boarding', clip: 'Board' },
      { row: 'passenger-seated', clip: 'Seated' },
      { row: 'passenger-fixture-activities', clip: 'Ticket, Bench' },
    ],
  },
  assets,
  validation: {
    errors: assets.reduce((sum, asset) => sum + asset.validation.errors, 0),
    warnings: assets.reduce((sum, asset) => sum + asset.validation.warnings, 0),
  },
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`PASSENGER_EXPORT_OK ${assets.length} models, ${summary.validation.errors} errors, ${summary.validation.warnings} warnings -> ${out}`)
