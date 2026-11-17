// Source-derived placement oracle; never reads a user station or changes a save.
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { placeLocalAtEdge } from '../../game/src/render/models/PieceBuilder.ts'
import { SHELF_VARIANTS, shelfSpec, shelfWidth } from '../../game/src/sim/shelves.ts'
import { EXTINGUISHER_SPECS } from '../../game/src/sim/extinguishers.ts'
const families = [
  ['tvm', '', .6, 1], ['vending', '', .732, 1], ['bin', '', .436, 1],
  ...SHELF_VARIANTS.map(v => ['shelf', v, shelfSpec(v).depth + (v.startsWith('cooler') ? .12 : 0), shelfWidth(v)]),
  ...Object.entries(EXTINGUISHER_SPECS).map(([v,s]) => ['extinguisher', v, s.depth, s.cells]),
]
const cases = []
for (const [type, variant, depth, w] of families) for (let rot = 0; rot < 4; rot++) {
  const module = { id: 'decor', type, x: -3, y: 7, z: -10, rot, w, cfg: { variant } }
  const glass = { id: 'backing', type: 'glass', x: -3, y: 7, z: -10, rot: (rot + 2) % 4, w: 2, cfg: { variant: '2x4' } }
  for (const backing of ['free', 'curtain-first', 'decor-first']) {
    const modules = backing === 'free' ? [module] : backing === 'curtain-first' ? [glass, module] : [module, glass]
    const group = placeLocalAtEdge(new THREE.Group(), module, depth, modules)
    group.updateMatrixWorld(true)
    const back = group.localToWorld(new THREE.Vector3(0, depth / 2, 0))
    const round = values => values.map(v => Math.round(v * 1e6) / 1e6)
    cases.push({ type, variant, rot, backing, module, modules, position: round(group.position.toArray()), back: round(back.toArray()) })
  }
}
const output = new URL('../../unity/Assets/StationDesigner/Tests/EditMode/edge-placement-oracle.json', import.meta.url)
const text = JSON.stringify({ source: 'PieceBuilder.placeLocalAtEdge + placement.edgeDecorCurtainOffset', cases }, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== text) throw new Error('edge-placement oracle is stale')
} else writeFileSync(output, text)
console.log(`EDGE_PLACEMENT_ORACLE ${cases.length} cases`)
