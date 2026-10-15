import { unzlibSync } from 'three/addons/libs/fflate.module.js'

/** Lossless baked buffers; legacy atlases contain plain base64. */
export function decodePassengerBytes(value: string, encoding?: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
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
