import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Rng, hashString } from '../../game/src/sim/rng.ts'

// A small oracle fixture: fixed steps and explicit UTF-16 hash input.
const seed = 1234567, rng = new Rng(seed)
const fixture = {
  schemaVersion: 1, id: 'rng-utf16', sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  seed, commands: Array.from({length:5}, () => 'next'),
  output: { values: Array.from({length:5}, () => rng.next()), state: rng.state, hashInput: '站😀A', hash: hashString('站😀A') },
}
writeFileSync(new URL('../../unity/Assets/StationDesigner/Tests/EditMode/rng-oracle.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n')
