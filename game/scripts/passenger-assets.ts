import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const atlasId = '\0passenger-atlas'
const partSize = 20 * 1024 * 1024
const workerAssetLimit = 25 * 1024 * 1024

/** Keep the baked source intact, but fetch packed bytes without parsing base64 JS. */
export function passengerAssets(): Plugin {
  return {
    name: 'passenger-assets',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      if (id.endsWith('/passenger-approved.json')) return atlasId
    },
    load(id) {
      if (id !== atlasId) return
      const path = new URL('../src/assets/passenger-approved.json', import.meta.url)
      this.addWatchFile(fileURLToPath(path))
      const human = JSON.parse(readFileSync(path, 'utf8'))
      const urls: string[] = []
      const fields: string[] = []
      for (const key of ['positions', 'normals', 'indices', 'lowIndices', 'regions']) {
        const value = Buffer.from(human[key], 'base64')
        const names: string[] = []
        for (let offset = 0; offset < value.length; offset += partSize) {
          const asset = this.emitFile({ type: 'asset', name: `passenger-${key}-${offset / partSize}.bin`, source: value.subarray(offset, offset + partSize) })
          names.push(`chunks[${urls.length}]`)
          urls.push(`import.meta.ROLLUP_FILE_URL_${asset}`)
        }
        fields.push(`${JSON.stringify(key)}: ${names.length === 1 ? names[0] : `join([${names.join(',')}])`}`)
        delete human[key]
      }
      return `
const chunks = await Promise.all([${urls.join(',')}].map(async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Passenger atlas fetch failed: ' + response.status);
  return new Uint8Array(await response.arrayBuffer());
}));
function join(parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export default { ...${JSON.stringify(human)}, ${fields.join(',')} };`
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        const source = file.type === 'chunk' ? file.code : file.source
        const size = typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength
        if (size >= workerAssetLimit) {
          this.error(`${file.fileName} is ${(size / 1024 / 1024).toFixed(1)} MiB; Cloudflare Workers assets must be smaller than 25 MiB.`)
        }
      }
    },
  }
}
