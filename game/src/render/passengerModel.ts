import * as THREE from 'three'
import human from '../assets/passenger-human.json' with { type: 'json' }

/** CC0 clothed humans and walking poses, baked offline; see assets/PASSENGERS.md. */
export const PASSENGER_EYE_HEIGHT = 1.57
export const PASSENGER_STRIDE = human.stride
export const PASSENGER_WALK_FRAMES = human.walkFrames
export const PASSENGER_OUTFITS = human.variants
export const PASSENGER_HAIRSTYLES = human.hairstyles

/** Identity, rather than buffer slot, keeps each commuter's appearance stable. */
export function passengerAppearance(id: number, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  let hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0xc2b2ae35) >>> 0
  hash ^= hash >>> 16
  out[0] = (hash >>> 0) % PASSENGER_OUTFITS.length
  const height = ((hash >>> 8) & 255) / 255
  // About one in eight passengers is child-sized (1.0–1.4 m); the rest
  // span shorter adults through tall commuters (1.47–1.94 m).
  const child = (hash & 255) < 32
  out[1] = child ? 0.58 + height * 0.23 : 0.85 + height * 0.27
  out[2] = (0.9 + ((hash >>> 16) & 255) / 255 * 0.2) * (child ? out[1] * 1.08 : 1)
  out[3] = 0.9 + ((hash >>> 24) & 255) / 255 * 0.15
  return out
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}

const bakedPositions = new Int16Array(bytes(human.positions).buffer)
const bakedNormals = new Int8Array(bytes(human.normals).buffer)
const bakedIndices = new Uint16Array(bytes(human.indices).buffer)

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

export function passengerMaterial(): THREE.MeshStandardMaterial {
  // Matte grey washes show clothed silhouettes without distracting textures.
  return new THREE.MeshStandardMaterial({ color: 0xb3b5b7, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.94, depthWrite: true })
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
  const material = passengerMaterial()
  material.onBeforeCompile = (shader) => {
    shader.uniforms.passengerPositions = { value: positions }
    shader.uniforms.passengerNormals = { value: normals }
    shader.uniforms.passengerIndices = { value: indices }
    shader.uniforms.passengerAtlasSize = { value: new THREE.Vector2(positions.image.width, positions.image.height) }
    shader.vertexShader = `
      attribute float passengerVertex;
      attribute vec4 passengerPose;
      attribute float passengerOutfit;
      uniform sampler2D passengerPositions;
      uniform sampler2D passengerNormals;
      uniform sampler2D passengerIndices;
      uniform vec2 passengerAtlasSize;
      vec3 passengerSample(sampler2D data, float frame) {
        float corner = passengerVertex + passengerOutfit * ${human.corners.toFixed(1)};
        float vertex = texture2D(passengerIndices, vec2((mod(corner, 1024.0) + 0.5) / 1024.0,
          (floor(corner / 1024.0) + 0.5) / ${indexRows.toFixed(1)})).r;
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
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(passengerAnimated(passengerNormals));')
      .replace('#include <begin_vertex>', 'vec3 transformed = passengerAnimated(passengerPositions);')
  }
  material.customProgramCacheKey = () => 'passenger-clothed-hair-poses-v3'
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
  }
  return mesh
}

/** Travel-driven gait: queued passengers and conveyor/lift riders do not march. */
export function passengerFrames(distance: number, phase: number, weight: number, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  const frame = (((phase + distance / PASSENGER_STRIDE) % 1 + 1) % 1) * PASSENGER_WALK_FRAMES
  const first = Math.floor(frame)
  out[0] = first + 1
  out[1] = (first + 1) % PASSENGER_WALK_FRAMES + 1
  out[2] = frame - first
  out[3] = weight
  return out
}
