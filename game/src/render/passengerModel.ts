import * as THREE from 'three'
import human from '../assets/passenger-approved.json' with { type: 'json' }
import { passengerIsChild, passengerProportions } from '../sim/walking.ts'
import { AgentRenderState } from '../sim/types.ts'
import { activityChoice, ACTIVITY_SAMPLES } from '../sim/activities.ts'
import { trainScaleForStorey } from '../sim/stock.ts'
import { passengerEligible } from './passengerEligibility.ts'
import { decodePassengerBytes, restorePassengerFrames } from './passengerAtlas.ts'
import { activityShader, disposePassengerActivities } from './passengerActivities.ts'

/** Selected soft-human wardrobe and baked motion; see assets/PASSENGERS.md. */
export const PASSENGER_EYE_HEIGHT = 1.48
export const PASSENGER_STRIDE = human.stride
export const PASSENGER_WALK_FRAMES = human.walkFrames
export const PASSENGER_WALK_PROFILES = human.walkProfiles
export const PASSENGER_LIBRARY = human.library.map(model => ({ ...model,
  childEligible: passengerEligible(model, 'child'), adultEligible: passengerEligible(model, 'adult') }))
export const PASSENGER_OUTFITS = human.variants
export const PASSENGER_HAIRSTYLES = human.hairstyles
// Every selected-base recipe supports both ages; size stays identity-driven.
export const PASSENGER_CHILD_OUTFITS = human.library.flatMap((model, index) => passengerEligible(model, 'child') ? [index] : [])
export const PASSENGER_ADULT_OUTFITS = human.library.flatMap((model, index) => passengerEligible(model, 'adult') ? [index] : [])
export type PassengerAppearance = [outfit: number, height: number, depth: number, width: number, tone: number]

/** A narrow run has a reachable belt on either side. Switch belts when the
 * requested hand is carrying; wide-lane poses keep their actual target. */
export function passengerDisplayedActivity(kind: number, outfit: number, time = 0): number {
  const model=PASSENGER_LIBRARY[outfit]
  if (model.bagType==='purse'||model.bagType==='handbag') {
    const right=model.bagSide==='right'
    const wide = Math.floor((time / 10 * (ACTIVITY_SAMPLES - 1) + .01) / 6) % 2 === 1
    if (!wide && ((kind===7&&right)||(kind===14&&!right))) return kind===7?14:7
  }
  return kind
}

/** 0 = default/two hands, 1 = right only, 2 = left only. Stable action-specific
 * preferences consume no sim RNG. A hand-owned bag always reserves that hand. */
export function passengerActionMode(kind: number, outfit: number, id: number, preferred = 0): number {
  if (kind===0||kind===1||kind===9||kind===12||kind===13) return 0
  const model=PASSENGER_LIBRARY[outfit]
  if (model.bagType==='purse'||model.bagType==='handbag') return model.bagSide==='right'?2:1
  if (preferred===1||preferred===2) return preferred
  if (kind===7) return 1
  if (kind===14) return 2
  if (kind===10) return 0
  return activityChoice(id, 0x6a09e667 ^ kind * 0x45d9f3b)<.5?1:2
}

/** Pack hand mode beside the gait profile in the existing instance attribute. */
export function passengerActionChannel(kind: number, outfit: number, id: number, profile: number, preferred = 0): number {
  return profile + PASSENGER_WALK_PROFILES.length * passengerActionMode(kind, outfit, id, preferred)
}

/** Which prepared crowd topology a draw reads (§9.3). Both animate the same atlas. */
export type PassengerDetail = 'full' | 'low'

/** Identity, rather than buffer slot, keeps each commuter's appearance stable. */
export function passengerAppearance(id: number, out: PassengerAppearance = [0, 0, 0, 0, 0]): PassengerAppearance {
  // Reuse the caller's scratch tuple: no per-frame crowd allocations.
  passengerProportions(id, out)
  // Match the train's visual scale at the feet; simulation physique stays unchanged.
  const scale = trainScaleForStorey()
  out[4] = out[3]
  out[3] = out[2] * scale
  out[2] = out[1] * scale
  out[1] = out[0] * scale
  // A separate identity hash chooses equally within the age-appropriate pool,
  // independently of size and gait, without advancing simulation randomness.
  let hash = Math.imul(id ^ 0x51ed270b, 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0
  hash = (hash ^ (hash >>> 16)) >>> 0
  out[0] = passengerIsChild(id)
    ? PASSENGER_CHILD_OUTFITS[Math.floor(hash / 0x100000000 * PASSENGER_CHILD_OUTFITS.length)]
    : PASSENGER_ADULT_OUTFITS[Math.floor(hash / 0x100000000 * PASSENGER_ADULT_OUTFITS.length)]
  return out
}

function bytes(value: string | Uint8Array): Uint8Array {
  return decodePassengerBytes(value, (human as { encoding?: string }).encoding)
}

const poseEncoding = (human as { poseEncoding?: string }).poseEncoding
const bakedPositions = restorePassengerFrames(new Int16Array(bytes(human.positions).buffer), human.vertices, poseEncoding)
const bakedNormals = restorePassengerFrames(new Int8Array(bytes(human.normals).buffer), human.vertices, poseEncoding)
const bakedIndices = human.indexBits === 32 ? new Uint32Array(bytes(human.indices).buffer) : new Uint16Array(bytes(human.indices).buffer)
const bakedRegions = bytes(human.regions)

/**
 * The baked Low topology (§9.3): a second, coarser index table over the *same*
 * shared pose atlas. Every simplified corner references a vertex whose walk,
 * normal and palette region are already baked, so the full and Low draws share
 * one texture set — a quality change only swaps the index table and geometry.
 * Older atlases without the table fall back to the full topology rather than
 * failing; the table itself is generated by `tools/bake-approved-passenger.mjs`.
 */
const bakedLow = human as typeof human & { lowCorners?: number; lowIndices?: string }
export const PASSENGER_HAS_LOW_DETAIL = bakedLow.lowIndices !== undefined && bakedLow.lowCorners !== undefined
const LOW_CORNERS = PASSENGER_HAS_LOW_DETAIL ? bakedLow.lowCorners! : human.corners
const bakedLowIndices = PASSENGER_HAS_LOW_DETAIL
  ? (human.indexBits === 32 ? new Uint32Array(bytes(bakedLow.lowIndices!).buffer) : new Uint16Array(bytes(bakedLow.lowIndices!).buffer))
  : bakedIndices
/** Triangles one Low-detail passenger submits (the padded shared stride). */
export const PASSENGER_LOW_TRIANGLES = LOW_CORNERS / 3
/** Triangles one full-detail passenger submits. */
export const PASSENGER_FULL_TRIANGLES = human.corners / 3

function expanded(values: Int16Array | Int8Array, frame: number, outfit: number, divisor: number, detail: PassengerDetail = 'full'): Float32Array {
  const corners = detail === 'low' ? LOW_CORNERS : human.corners
  const table = detail === 'low' ? bakedLowIndices : bakedIndices
  const offset = frame * human.vertices * 3
  const result = new Float32Array(corners * 3)
  for (let i = 0; i < corners; i++) {
    const vertex = offset + table[outfit * corners + i] * 3
    for (let axis = 0; axis < 3; axis++) result[i * 3 + axis] = values[vertex + axis] / divisor
  }
  return result
}

export function passengerPose(frame: number, outfit = 0): Float32Array {
  return expanded(bakedPositions, frame, outfit, human.positionScale)
}

export function passengerBody(low = false): THREE.BufferGeometry {
  const detail: PassengerDetail = low ? 'low' : 'full'
  const corners = low ? LOW_CORNERS : human.corners
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from({ length: corners }, (_, i) => i), 1))
  geometry.setAttribute('position', new THREE.BufferAttribute(expanded(bakedPositions, 0, 0, human.positionScale, detail), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(expanded(bakedNormals, 0, 0, human.normalScale, detail), 3))
  geometry.setAttribute('passengerVertex', new THREE.BufferAttribute(Float32Array.from({ length: corners }, (_, i) => i), 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export const PASSENGER_ATLAS_WIDTH = 2 ** Math.ceil(Math.log2(Math.max(1024, Math.ceil(human.vertices * human.frames / 8192))))
function atlas(values: Int16Array | Int8Array): THREE.DataTexture {
  const width = PASSENGER_ATLAS_WIDTH
  const rows = Math.ceil(human.vertices * human.frames / width)
  const pixels = values instanceof Int16Array ? new Int16Array(width * rows * 4) : new Int8Array(width * rows * 4)
  for (let i = 0; i < values.length / 3; i++) {
    pixels[i * 4] = values[i * 3]
    pixels[i * 4 + 1] = values[i * 3 + 1]
    pixels[i * 4 + 2] = values[i * 3 + 2]
  }
  const texture = new THREE.DataTexture(pixels, width, rows, THREE.RGBAIntegerFormat, values instanceof Int16Array ? THREE.ShortType : THREE.ByteType)
  texture.needsUpdate = true
  return texture
}

interface PassengerAtlases {
  positions: THREE.DataTexture
  normals: THREE.DataTexture
  regions: THREE.DataTexture
  /** Uploaded on first use: a crowd that never draws Low never allocates its table. */
  indices: Map<PassengerDetail, { texture: THREE.DataTexture; rows: number; width: number }>
  dispose(): void
}

/** One GPU copy of the baked poses, shared by the full and Low crowd draws. */
let shared: PassengerAtlases | null = null
function passengerAtlases(): PassengerAtlases {
  if (shared) return shared
  const regionPixels = new Float32Array(1024 * Math.ceil(human.vertices / 1024))
  regionPixels.set(bakedRegions)
  const regions = new THREE.DataTexture(regionPixels, 1024, regionPixels.length / 1024, THREE.RedFormat, THREE.FloatType)
  regions.needsUpdate = true
  shared = {
    positions: atlas(bakedPositions),
    normals: atlas(bakedNormals),
    regions,
    indices: new Map(),
    dispose() {
      this.positions.dispose()
      this.normals.dispose()
      this.regions.dispose()
      for (const entry of this.indices.values()) entry.texture.dispose()
      disposePassengerActivities()
      this.indices.clear()
      if (shared === this) shared = null
    },
  }
  return shared
}

function indexTable(detail: PassengerDetail): { texture: THREE.DataTexture; rows: number; width: number } {
  const atlases = passengerAtlases()
  const cached = atlases.indices.get(detail)
  if (cached) return cached
  const table = detail === 'low' ? bakedLowIndices : bakedIndices
  // Outfit growth widens the prepared table before exceeding 8192 GPU rows.
  const width = 2 ** Math.ceil(Math.log2(Math.max(1024, Math.ceil(table.length / 8192))))
  const rows = Math.ceil(table.length / width)
  const pixels = new Float32Array(width * rows)
  pixels.set(table)
  const texture = new THREE.DataTexture(pixels, width, rows, THREE.RedFormat, THREE.FloatType)
  texture.needsUpdate = true
  const entry = { texture, rows, width }
  atlases.indices.set(detail, entry)
  return entry
}

export function passengerMaterial(detail: PassengerDetail = 'full'): THREE.MeshBasicMaterial {
  // Illustration colours stay flat under the station's lights and exposure.
  // The legacy sim alpha constants also drive traffic. People use the opaque
  // depth-writing path at both LODs so their own surfaces occlude correctly.
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: false,
    opacity: 1, depthWrite: true })
  const corners = detail === 'low' ? LOW_CORNERS : human.corners
  const indices = indexTable(detail)
  const atlases = passengerAtlases()
  material.onBeforeCompile = (shader) => {
    const activity = activityShader(detail)
    Object.assign(shader.uniforms, activity.uniforms)
    shader.uniforms.passengerPositions = { value: atlases.positions }
    shader.uniforms.passengerNormals = { value: atlases.normals }
    shader.uniforms.passengerIndices = { value: indices.texture }
    shader.uniforms.passengerRegions = { value: atlases.regions }
    shader.uniforms.passengerAtlasSize = { value: new THREE.Vector2(atlases.positions.image.width, atlases.positions.image.height) }
    shader.vertexShader = `
      attribute float passengerVertex;
      attribute vec4 passengerPose;
      attribute float passengerOutfit;
      uniform highp isampler2D passengerPositions;
      uniform highp isampler2D passengerNormals;
      uniform sampler2D passengerIndices;
      uniform sampler2D passengerRegions;
      uniform vec2 passengerAtlasSize;
      varying vec3 passengerInk;
      varying vec3 passengerNormal;
      varying vec3 passengerView;
      varying float passengerRegion;
      float passengerIndex() {
        float corner = passengerVertex + passengerOutfit * ${corners.toFixed(1)};
        return texture2D(passengerIndices, vec2((mod(corner, ${indices.width.toFixed(1)}) + 0.5) / ${indices.width.toFixed(1)},
          (floor(corner / ${indices.width.toFixed(1)}) + 0.5) / ${indices.rows.toFixed(1)})).r;
      }
      vec3 passengerSample(highp isampler2D data, float frame, float divisor) {
        float vertex = passengerIndex();
        float pixel = vertex + frame * ${human.vertices.toFixed(1)};
        return vec3(texture2D(data, vec2((mod(pixel, passengerAtlasSize.x) + 0.5) / passengerAtlasSize.x,
          (floor(pixel / passengerAtlasSize.x) + 0.5) / passengerAtlasSize.y)).xyz) / divisor;
      }
      vec3 passengerAnimated(highp isampler2D data, float divisor) {
        vec3 idle = passengerSample(data, 0.0, divisor);
        vec3 walk = mix(passengerSample(data, passengerPose.x, divisor),
          passengerSample(data, passengerPose.y, divisor), passengerPose.z);
        return mix(idle, walk, passengerPose.w);
      }
    ` + activity.source + shader.vertexShader
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', `
        vec3 transformed = passengerUsesActivityRig() ? activityPosition(false) : passengerAnimated(passengerPositions, ${human.positionScale.toFixed(1)});
        vec3 objectNormal = normalize(passengerUsesActivityRig() ? activityPosition(true) : passengerAnimated(passengerNormals, ${human.normalScale.toFixed(1)}));
        if (passengerActivity.x==12.0 || passengerActivity.x==13.0) {
          float head=smoothstep(1.30,1.46,transformed.z);
          float turn=.16*sin(passengerActivity.y*.55)*head;
          mat2 look=mat2(cos(turn),sin(turn),-sin(turn),cos(turn));
          transformed.xy=look*transformed.xy;
          objectNormal.xy=look*objectNormal.xy;
          transformed.y+=.009*sin(passengerActivity.y)*smoothstep(.15,.8,transformed.z);
        }
        #include <defaultnormal_vertex>
        passengerNormal = normalize(transformedNormal);
        float vertex = passengerIndex();
        passengerRegion = texture2D(passengerRegions, vec2((mod(vertex, 1024.0) + 0.5) / 1024.0,
          (floor(vertex / 1024.0) + 0.5) / ${Math.ceil(human.vertices / 1024).toFixed(1)})).r;
        if(passengerUsesActivityRig()) passengerRegion = activityRegion();
        passengerInk = ${human.paletteRGB.map((color, i) => `${i < human.paletteRGB.length - 1 ? `passengerRegion < ${(i + .5).toFixed(1)} ? ` : ''}vec3(${new THREE.Color(color).toArray().map(v=>v.toFixed(6)).join(',')})`).join(' : ')};
      `)
      .replace('#include <project_vertex>', '#include <project_vertex>\npassengerView = -mvPosition.xyz;')
    shader.fragmentShader = `
      varying vec3 passengerInk;
      varying vec3 passengerNormal;
      varying vec3 passengerView;
      varying float passengerRegion;
    ` + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      diffuseColor.rgb *= passengerInk;
      // The rounded white head needs shape against pale station surfaces.
      // Reuse the baked smooth normals; no station-light or skeleton work.
      float softLight=.72+.28*max(0.0,dot(normalize(passengerNormal),normalize(vec3(-.4,.6,1.0))));
      diffuseColor.rgb *= softLight;
    `)
  }
  // The two topologies sample different tables and strides: separate programs.
  material.customProgramCacheKey = () => `passenger-soft-human-${human.recipeSha256}-${detail}`
  return material
}

/**
 * One prepared crowd draw (§7.1). The renderer keeps two of these — the full and
 * the Low topology — and packs each passenger into the one its storey asks for;
 * no per-passenger skeleton or animation mixer is introduced.
 */
export function passengerMesh(capacity: number, detail: PassengerDetail = 'full'): THREE.InstancedMesh {
  const geometry = passengerBody(detail === 'low')
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  pose.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('passengerPose', pose)
  const activity = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  activity.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('passengerActivity', activity)
  geometry.setAttribute('passengerGarment',new THREE.InstancedBufferAttribute(new Float32Array(capacity*2),2))
  geometry.setAttribute('passengerOutfit', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1))
  // The storey each packed instance stands on (`storeyBand` metres), the value the
  // renderer classifies for detail and the one a shader would read if the split
  // ever moves to the GPU. Unreferenced by the current programs, so it costs no
  // GPU upload — it is the crowd's per-instance level record.
  const level = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
  level.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('passengerLevel', level)
  const material = passengerMaterial(detail)
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.count = 0
  // Allocate the color attribute before the first shader compilation.
  mesh.setColorAt(0, new THREE.Color(1, 1, 1))
  // The pose/normal/region atlas and both index tables outlive either draw: the
  // scene owns them once, and whichever draw is torn down releases them together.
  mesh.userData.disposePassenger = () => passengerAtlases().dispose()
  return mesh
}

/** Stair travel includes rise; transported passengers keep planted feet. */
export function passengerWalkDistance(state: number, dx: number, dy: number, dz: number): number {
  return state === AgentRenderState.Riding ? 0 : Math.hypot(dx, dy, state === AgentRenderState.StairWalking ? dz : 0)
}

/** Travel-driven gait: queued passengers and conveyor/lift riders do not march. */
export function passengerFrames(distance: number, phase: number, weight: number, out: [number, number, number, number] = [0, 0, 0, 0], profile = 0): [number, number, number, number] {
  const walk = PASSENGER_WALK_PROFILES[profile]
  const frame = (((phase + distance / walk.stride) % 1 + 1) % 1) * PASSENGER_WALK_FRAMES
  const first = Math.floor(frame)
  out[0] = first + walk.firstFrame
  out[1] = (first + 1) % PASSENGER_WALK_FRAMES + walk.firstFrame
  out[2] = frame - first
  out[3] = weight
  return out
}
