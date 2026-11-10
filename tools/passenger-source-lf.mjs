// Derive a platform-neutral verification record only from an already-matched bake.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root=resolve(import.meta.dirname,'..')
const asset=JSON.parse(readFileSync(resolve(root,'game/src/assets/passenger-approved.json'),'utf8'))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const normalized={}
for (const [path,expected] of Object.entries(asset.sourceHashes)) {
  const bytes=readFileSync(resolve(root,path))
  if (sha(bytes)!==expected) throw Error(`${path} does not match baked raw provenance; rebake first`)
  normalized[path]=sha(bytes.toString('utf8').replace(/\r\n/g,'\n'))
}
const output={algorithm:'sha256-utf8-lf',recipeSha256:asset.recipeSha256,sourceHashes:normalized}
writeFileSync(resolve(root,'game/src/assets/passenger-source-lf.json'),JSON.stringify(output,null,2)+'\n')
console.log(`Wrote normalized verification for ${Object.keys(normalized).length} recipe inputs`)
