import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const oracle = JSON.parse(readFileSync(new URL('../Assets/StationDesigner/Tests/EditMode/edge-placement-oracle.json', import.meta.url)))
const mapping = JSON.parse(readFileSync(new URL('../asset-recipes/runtime-views.json', import.meta.url)))
test('edge furniture mapping retains the source pivot for every variant without a second run inset', () => {
  for (const c of oracle.cases.filter(c => c.backing === 'free')) {
    const key = c.type === 'shelf' ? `shelf-${c.variant}` : c.type === 'extinguisher' && c.variant !== 'standard' ? `${c.type}-${c.variant}` : c.type
    if (c.rot !== 0) continue
    const entry = mapping.views.find(e => e.key === key)
    assert.ok(entry, key)
    const expected = c.position.map((value, i) => value - [c.module.x, c.module.y, c.module.z][i])
    entry.offset.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6, `${key} axis ${i}: ${value} != ${expected[i]}`))
  }
})
test('edge placement oracle is reproducible from the real web transform and curtain rules', () => {
  execFileSync(process.execPath, ['tools/unity-parity/record-edge-placement.mjs', '--check'], { cwd: new URL('../../', import.meta.url), stdio: 'pipe' })
})
