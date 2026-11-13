// Serve the newest packed StationGame player on loopback for a local preview.
//
//   node tools/unity-web/serve-latest-pack.mjs [--port 8799] [--pack <dir>]
//
// Without `--pack` it reads the pack the build pipeline last wrote
// (`.preview/unity/station-game-local.jsonc` -> assets.directory) and serves it with
// the same routing/reassembly the Worker uses (`static-pack-server.mjs`). Useful on
// machines where `wrangler dev` cannot start (workerd fails with an ACL error here).
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createStaticServer } from './static-pack-server.mjs'

const root = resolve(import.meta.dirname, '../..')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const configPath = join(root, '.preview/unity/station-game-local.jsonc')
let pack = arg('--pack')
if (!pack) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    pack = resolve(dirname(configPath), config.assets?.directory ?? '')
  } catch (error) {
    console.error('No pack configured: ' + configPath + ' (' + error.message + ')')
    console.error('Build one first: npm run build:unity')
    process.exit(1)
  }
}
pack = resolve(pack)
const port = Number(arg('--port', 8799))
const { url } = await createStaticServer(pack, port)
console.log('LOCAL_PREVIEW ' + url + '/game/ pack=' + pack)
console.log('Deep links: /game/zoo /game/en/zoo /game/tanwei /game/tianhe (locale by the path)')
