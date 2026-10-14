import { unzlibSync } from 'three/addons/libs/fflate.module.js'

/** Lossless baked buffers; legacy atlases contain plain base64. */
export function decodePassengerBytes(value: string, encoding?: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (encoding === undefined) return bytes
  if (encoding === 'zlib-base64') return unzlibSync(bytes)
  throw new Error(`Unsupported passenger atlas encoding: ${encoding}`)
}
