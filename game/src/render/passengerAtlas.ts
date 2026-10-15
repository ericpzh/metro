import { unzlibSync } from 'three/addons/libs/fflate.module.js'

/** Lossless baked buffers; legacy atlases contain plain base64. */
export function decodePassengerBytes(value: string | Uint8Array, encoding?: string): Uint8Array {
  const native = (Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array }).fromBase64
  let bytes: Uint8Array
  if (value instanceof Uint8Array) bytes = value
  else if (native) bytes = native.call(Uint8Array, value)
  else {
    const binary = atob(value)
    bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  }
  if (encoding === undefined) return bytes
  if (encoding === 'zlib-base64') return unzlibSync(bytes)
  throw new Error(`Unsupported passenger atlas encoding: ${encoding}`)
}

/** Undo lossless temporal deltas in place before constructing GPU textures.
 * Legacy atlases contain absolute frames and need no transform. Typed-array
 * assignment restores signed overflow exactly for both 16-bit poses and 8-bit normals. */
export function restorePassengerFrames<T extends Int16Array | Int8Array>(values: T, vertices: number, encoding?: string): T {
  if (encoding === undefined) return values
  if (encoding !== 'frame-delta') throw new Error(`Unsupported passenger pose encoding: ${encoding}`)
  const stride = vertices * 3
  if (!Number.isSafeInteger(vertices) || vertices < 1 || values.length % stride) throw new Error('Invalid passenger frame dimensions')
  for (let i = stride; i < values.length; i++) values[i] += values[i - stride]
  return values
}
