// Seeded production-simulation replay of the Tanwei 16x / 06:39:15 report.
// Playback speed changes scheduling, not the one-second simulation ticks.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { referenceStation } from '../game/src/data/reference-station.ts'
import { World } from '../game/src/sim/world.ts'
import { rotateLocal } from '../game/src/sim/track.ts'
import { PSD_WALL_OFFSET } from '../game/src/sim/constants.ts'

const seed = 1234567, ticks = 555
const w = new World(referenceStation('tanwei'), seed)
const banks = w.graph.platforms.map(p => {
  const m = w.data.modules.find(m => m.id === p.id)
  return { m, inward: rotateLocal(m.rot, 0, m.cfg.side === 'right' ? -1 : 1) }
})
let maximumBeyondScreen = 0, finalBeyondScreen = 0, firstViolation = null
for (let tick = 0; tick < ticks; tick++) {
  w.tickOnce()
  let beyond = 0
  for (const a of w.pool.live) {
    if (a.dead || a.train >= 0) continue
    for (const { m, inward: [ix, iy] } of banks) {
      if (Math.abs(a.z - m.z - 1) > .1) continue
      const [u] = rotateLocal(-(m.rot ?? 0), a.x - m.x - .5, a.y - m.y - .5)
      const depth = (a.x - m.x - .5) * ix + (a.y - m.y - .5) * iy
      if (u >= -.5 && u < m.w - .5 && depth < -PSD_WALL_OFFSET && depth > -2) beyond++
    }
  }
  maximumBeyondScreen = Math.max(maximumBeyondScreen, beyond)
  finalBeyondScreen = beyond
  if (beyond && firstViolation === null) firstViolation = w.simTime
}
const report = { station: 'tanwei', seed, ticks, simTime: w.simTime, agents: w.pool.count,
  maximumBeyondScreen, finalBeyondScreen, firstViolation, totals: w.totals }
const out = new URL('../.preview/psd/', import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL('replay.json', out), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
assert.equal(maximumBeyondScreen, 0, 'ordinary passengers must remain inland of the PSD throughout the replay')
