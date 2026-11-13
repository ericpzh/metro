// Ensure every asset under unity/Assets carries a .meta file. Unity creates these on
// import; this keeps a batch-mode scratch project and the committed tree in sync.
import { createHash } from 'node:crypto'
import { readdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '../..')
const assets = join(root, 'unity/Assets')
let created = 0
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stats = statSync(path)
    if (stats.isDirectory()) { walk(path); continue }
    if (name.endsWith('.meta')) continue
    const meta = path + '.meta'
    if (existsSync(meta)) continue
    const guid = createHash('md5').update(relative(root, path).replaceAll('\\', '/')).digest('hex')
    writeFileSync(meta, `fileFormatVersion: 2\nguid: ${guid}\n`)
    created++
    console.log('meta', relative(root, path))
  }
}
walk(assets)
console.log('created', created)
