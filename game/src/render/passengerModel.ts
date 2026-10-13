import * as THREE from 'three'
import human from '../assets/passenger-approved.json' with { type: 'json' }
import { passengerIsChild, passengerProportions } from '../sim/walking.ts'
import { PASSENGER_OPACITY } from '../sim/constants.ts'

/** Approved grey, faceless commuter and baked walk; see assets/PASSENGERS.md. */
export const PASSENGER_EYE_HEIGHT = 1.57
export const PASSENGER_STRIDE = human.stride
export const PASSENGER_WALK_FRAMES = human.walkFrames
export const PASSENGER_WALK_PROFILES = human.walkProfiles
export const PASSENGER_LIBRARY = human.library
export const PASSENGER_OUTFITS = human.variants
export const PASSENGER_HAIRSTYLES = human.hairstyles
// Reuse the reviewed meshes at child scale; bags and bald heads are adults only.
export const PASSENGER_CHILD_OUTFITS = human.library.flatMap((model, index) => !model.bag && model.hair !== 'bald' ? [index] : [])
export type PassengerAppearance = [outfit: number, height: number, depth: number, width: number, tone: number]

/** Identity, rather than buffer slot, keeps each commuter's appearance stable. */
export function passengerAppearance(id: number, out: PassengerAppearance = [0, 0, 0, 0, 0]): PassengerAppearance {
  // Reuse the caller's scratch tuple: no per-frame crowd allocations.
  passengerProportions(id, out)
  out[4] = out[3]
  out[3] = out[2]
  out[2] = out[1]
  out[1] = out[0]
  // A separate identity hash chooses equally within the age-appropriate pool,
  // independently of size and gait, without advancing simulation randomness.
  let hash = Math.imul(id ^ 0x51ed270b, 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0
  hash = (hash ^ (hash >>> 16)) >>> 0
  out[0] = passengerIsChild(id)
    ? PASSENGER_CHILD_OUTFITS[Math.floor(hash / 0x100000000 * PASSENGER_CHILD_OUTFITS.length)]
    : Math.floor(hash / 0x100000000 * PASSENGER_OUTFITS.length)
  return out
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}

const bakedPositions = new Int16Array(bytes(human.positions).buffer)
const bakedNormals = new Int8Array(bytes(human.normals).buffer)
const bakedIndices = human.indexBits === 32 ? new Uint32Array(bytes(human.indices).buffer) : new Uint16Array(bytes(human.indices).buffer)

function expanded(values: Int16Array | Int8Array, frame: number, outfit: number, divisor: number): Float32Array {
  const offset = frame * human.vertices * 3
  const result = new Float32Array(human.corners * 3)
  for (let i = 0; i < human.corners; i++) {
    const vertex = offset + bakedIndices[outfit * human.corners + i] * 3
    for (let axis = 0; axis < 3; axis++) result[i * 3 + axis] = values[vertex + axis] / divisor
  }
  return result
}

export function passengerPose(frame: number, outfit = 0): Float32Array {
  return expanded(bakedPositions, frame, outfit, human.positionScale)
}

export function passengerBody(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from({ length: human.corners }, (_, i) => i), 1))
  geometry.setAttribute('position', new THREE.BufferAttribute(passengerPose(0), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(expanded(bakedNormals, 0, 0, human.normalScale), 3))
  geometry.setAttribute('passengerVertex', new THREE.BufferAttribute(Float32Array.from({ length: human.corners }, (_, i) => i), 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function atlas(values: Int16Array | Int8Array, divisor: number): THREE.DataTexture {
  const width = 1024
  const rows = Math.ceil(human.vertices * human.frames / width)
  const pixels = new Float32Array(width * rows * 4)
  for (let i = 0; i < values.length / 3; i++) {
    pixels[i * 4] = values[i * 3] / divisor
    pixels[i * 4 + 1] = values[i * 3 + 1] / divisor
    pixels[i * 4 + 2] = values[i * 3 + 2] / divisor
  }
  const texture = new THREE.DataTexture(pixels, width, rows, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  return texture
}

export function passengerMaterial(): THREE.MeshBasicMaterial {
  // Illustration colours stay flat under the station's lights and exposure.
  return new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: PASSENGER_OPACITY, depthWrite: false })
}

/** One GPU draw for the whole crowd; no per-passenger skeleton or animation mixer. */
export function passengerMesh(capacity: number): THREE.InstancedMesh {
  const geometry = passengerBody()
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  pose.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute('passengerPose', pose)
  geometry.setAttribute('passengerOutfit', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1))
  const positions = atlas(bakedPositions, human.positionScale)
  const normals = atlas(bakedNormals, human.normalScale)
  // Each outfit has its own indexed topology. A small lookup maps the shared
  // triangle corners to its vertices without duplicating all 25 baked poses.
  const indexRows = Math.ceil(bakedIndices.length / 1024)
  const indexPixels = new Float32Array(1024 * indexRows)
  indexPixels.set(bakedIndices)
  const indices = new THREE.DataTexture(indexPixels, 1024, indexRows, THREE.RedFormat, THREE.FloatType)
  indices.needsUpdate = true
  const regionPixels = new Float32Array(1024 * Math.ceil(human.vertices / 1024))
  regionPixels.set(bytes(human.regions))
  const regions = new THREE.DataTexture(regionPixels, 1024, regionPixels.length / 1024, THREE.RedFormat, THREE.FloatType)
  regions.needsUpdate = true
  const material = passengerMaterial()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.passengerPositions = { value: positions }
    shader.uniforms.passengerNormals = { value: normals }
    shader.uniforms.passengerIndices = { value: indices }
    shader.uniforms.passengerRegions = { value: regions }
    shader.uniforms.passengerAtlasSize = { value: new THREE.Vector2(positions.image.width, positions.image.height) }
    shader.vertexShader = `
      attribute float passengerVertex;
      attribute vec4 passengerPose;
      attribute float passengerOutfit;
      uniform sampler2D passengerPositions;
      uniform sampler2D passengerNormals;
      uniform sampler2D passengerIndices;
      uniform sampler2D passengerRegions;
      uniform vec2 passengerAtlasSize;
      varying vec3 passengerInk;
      varying vec3 passengerNormal;
      varying vec3 passengerView;
      varying float passengerRegion;
      float passengerIndex() {
        float corner = passengerVertex + passengerOutfit * ${human.corners.toFixed(1)};
        return texture2D(passengerIndices, vec2((mod(corner, 1024.0) + 0.5) / 1024.0,
          (floor(corner / 1024.0) + 0.5) / ${indexRows.toFixed(1)})).r;
      }
      vec3 passengerSample(sampler2D data, float frame) {
        float vertex = passengerIndex();
        float pixel = vertex + frame * ${human.vertices.toFixed(1)};
        return texture2D(data, vec2((mod(pixel, passengerAtlasSize.x) + 0.5) / passengerAtlasSize.x,
          (floor(pixel / passengerAtlasSize.x) + 0.5) / passengerAtlasSize.y)).xyz;
      }
      vec3 passengerAnimated(sampler2D data) {
        vec3 idle = passengerSample(data, 0.0);
        vec3 walk = mix(passengerSample(data, passengerPose.x),
          passengerSample(data, passengerPose.y), passengerPose.z);
        return mix(idle, walk, passengerPose.w);
      }
    ` + shader.vertexShader
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', `
        vec3 transformed = passengerAnimated(passengerPositions);
        vec3 objectNormal = normalize(passengerAnimated(passengerNormals));
        #include <defaultnormal_vertex>
        passengerNormal = normalize(transformedNormal);
        float vertex = passengerIndex();
        passengerRegion = texture2D(passengerRegions, vec2((mod(vertex, 1024.0) + 0.5) / 1024.0,
          (floor(vertex / 1024.0) + 0.5) / ${(regionPixels.length / 1024).toFixed(1)})).r;
        passengerInk = ${human.palette.map((grey, i) => `${i < human.palette.length - 1 ? `passengerRegion < ${(i + .5).toFixed(1)} ? ` : ''}vec3(${new THREE.Color().setRGB(grey, grey, grey, THREE.SRGBColorSpace).r.toFixed(6)})`).join(' : ')};
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
    `)
  }
  material.customProgramCacheKey = () => 'passenger-approved-library-v3'
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.count = 0
  // Allocate the color attribute before the first shader compilation.
  mesh.setColorAt(0, new THREE.Color(1, 1, 1))
  mesh.userData.disposePassenger = () => {
    positions.dispose()
    normals.dispose()
    indices.dispose()
    regions.dispose()
  }
  return mesh
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
