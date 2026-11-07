// Measure the presentation-document stage independently of WebGL construction.
// Usage: node --expose-gc tools/bench-explode-snapshot.mjs <save.metro.json>
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { explodedView } from '../game/src/render/explodedView.ts'

if (!process.argv[2]) throw Error('Pass a .metro.json save path')
const save = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const data = {...save, ...save.static}
explodedView(data)
for (let i=0; i<6; i++) {
  global.gc?.()
  const start=performance.now(), result=explodedView(data)
  console.log(JSON.stringify({ms:performance.now()-start, levels:result.levels, offsets:[...result.offsets], direction:result.direction, cells:result.data.cells.length, modules:result.data.modules.length}))
}
