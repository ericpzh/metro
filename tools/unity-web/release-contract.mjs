// Phase 1 contract helpers. These do not change the Phase 0 smoke pack or deploy.
import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const sha = /^[a-f0-9]{64}$/
const sourceSha = /^[a-f0-9]{40}$/
const knownTypes = new Map([
  ['.js','application/javascript'], ['.wasm','application/wasm'],
  ['.data','application/octet-stream'], ['.bin','application/octet-stream'], ['.json','application/json'],
  ['.html','text/html; charset=utf-8'], ['.css','text/css'],
  ['.png','image/png'], ['.jpg','image/jpeg'], ['.jpeg','image/jpeg'],
  ['.svg','image/svg+xml'], ['.ico','image/x-icon'], ['.txt','text/plain; charset=utf-8'],
  ['.webp','image/webp'], ['.ttf','font/ttf'], ['.woff2','font/woff2'],
])

import { validResourcePath } from './route-contract.mjs'
export { validResourcePath } from './route-contract.mjs'

export function resourceType(path) {
  if (!validResourcePath(path)) throw Error(`Invalid resource path: ${path}`)
  const compression = path.endsWith('.br') ? 'br' : path.endsWith('.gz') ? 'gzip' : null
  const base = compression ? path.slice(0, path.lastIndexOf('.')) : path
  const ext = base.slice(base.lastIndexOf('.')).toLowerCase()
  const contentType = knownTypes.get(ext)
  if (!contentType) throw Error(`Unrecognized resource extension: ${path}`)
  return { contentType, compression }
}

// Digest describes exact staged resources, independent of manifest order.
export function artifactDigest(files) {
  const canonical = files.map(({path,bytes,sha256,contentType,compression}) =>
    ({path,bytes,sha256,contentType,compression})).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return hash(JSON.stringify(canonical))
}

export function validateReleaseManifest(manifest, readBytes) {
  if (!manifest || !sourceSha.test(manifest.sourceSha ?? '') || !Array.isArray(manifest.files)) throw Error('Invalid release manifest')
  const seen = new Set()
  for (const file of manifest.files) {
    const expected = resourceType(file.path)
    if (seen.has(file.path)) throw Error(`Duplicate resource: ${file.path}`)
    seen.add(file.path)
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes >= 25 * 1024 * 1024 || !sha.test(file.sha256 ?? '')) throw Error(`Invalid resource metadata: ${file.path}`)
    if (file.contentType !== expected.contentType || file.compression !== expected.compression) throw Error(`Incorrect content metadata: ${file.path}`)
    if (readBytes) {
      const bytes = readBytes(file.path)
      if (!bytes || bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error(`Resource digest mismatch: ${file.path}`)
    }
  }
  for (const suffix of ['.loader.js','.framework.js','.wasm','.data']) {
    const count = [...seen].filter(p => p.replace(/\.(br|gz)$/, '').endsWith(suffix)).length
    if (count !== 1) throw Error(`Expected exactly one ${suffix} resource`)
  }
  const digest = artifactDigest(manifest.files)
  if (manifest.artifactSha256 !== digest || manifest.releaseId !== `${manifest.sourceSha}-${digest.slice(0,16)}`) throw Error('Release identity mismatch')
  return { releaseId: manifest.releaseId, artifactSha256: digest, files: seen.size }
}

export { classifyGamePath } from './route-contract.mjs'


