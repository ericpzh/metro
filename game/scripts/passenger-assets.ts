import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const atlasId = '\0passenger-atlas'
const partPrefix = '\0passenger-atlas-part-'
const partSize = 8 * 1024 * 1024
const workerAssetLimit = 25 * 1024 * 1024

/** Keep the baked source intact, but ship its buffers in bounded JS modules. */
export function passengerAssets(): Plugin {
  const parts = new Map<string, string>()
  return {
    name: 'passenger-assets',
    apply: 'build',
    enforce: 'pre',
    buildStart() { parts.clear() },
    resolveId(id) {
      if (id.endsWith('/passenger-approved.json')) return atlasId
      if (id.startsWith(partPrefix)) return id
    },
    load(id) {
      if (parts.has(id)) return `export default ${JSON.stringify(parts.get(id))};`
      if (id !== atlasId) return
      const path = new URL('../src/assets/passenger-approved.json', import.meta.url)
      this.addWatchFile(fileURLToPath(path))
      const human = JSON.parse(readFileSync(path, 'utf8'))
      const imports: string[] = []
      const fields: string[] = []
      for (const key of ['positions', 'normals', 'indices', 'regions']) {
        const value: string = human[key]
        const names: string[] = []
        for (let offset = 0; offset < value.length; offset += partSize) {
          const name = `part${parts.size}`
          const partId = `${partPrefix}${parts.size}`
          parts.set(partId, value.slice(offset, offset + partSize))
          imports.push(`import ${name} from ${JSON.stringify(partId)};`)
          names.push(name)
        }
        fields.push(`${JSON.stringify(key)}: [${names.join(',')}].join('')`)
        delete human[key]
      }
      return `${imports.join('\n')}\nexport default { ...${JSON.stringify(human)}, ${fields.join(',')} };`
    },
    outputOptions(options) {
      // Explicit groups keep the bundler from merging the large strings again.
      options.codeSplitting = {
        groups: [{
          debugName: 'passenger-data',
          test: id => id.startsWith(partPrefix),
          name: id => `passenger-data-${id.slice(partPrefix.length)}`,
        }],
      }
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
