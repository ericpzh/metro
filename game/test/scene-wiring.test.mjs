// The scene systems' wiring (`render/scene/SceneRenderer.ts`).
//
// Every system declares the siblings it walks with a definite-assignment claim —
// `chunks!: ChunkSystem`, `modules!: ModuleSystem` — because the orchestrator
// sets them after construction. TypeScript believes that claim, so a wiring line
// that goes missing in a refactor compiles cleanly and blows up on the first
// frame instead:
//
//     TypeError: Cannot read properties of undefined (reading 'outlineSet')
//         at LevelSystem.applyLevel (LevelSystem.ts:69)
//         at SceneRenderer.setStation (SceneRenderer.ts:183)
//
// That is exactly what happened when `this.level.chunks = this.chunks` was
// dropped while a new system was added. This test is the guard: every claimed
// reference has to be assigned in the orchestrator's constructor.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const SYSTEMS = 'render/scene/systems/'
const ORCHESTRATOR = 'render/scene/SceneRenderer.ts'

/** Which system owns which field name, so a claimed name maps to `this.<owner>.<name>`. */
const ORCHESTRATOR_FIELDS = {
  ChunkSystem: 'chunks',
  ModuleSystem: 'modules',
  GhostSystem: 'ghostSys',
  LevelSystem: 'level',
  TrainSystem: 'trains',
  LiftSystem: 'lifts',
  CrowdSystem: 'crowd',
  GridSystem: 'grid',
  CameraSystem: 'cameraSys',
  PlateSystem: 'plates',
  SectionSystem: 'sectionSys',
}

function systemFiles() {
  return fs
    .readdirSync(new URL(SYSTEMS, SRC))
    .filter((f) => f.endsWith('System.ts') && f !== 'SceneSystem.ts')
}

/** `name!: Type` inside a class body — a sibling the orchestrator must wire. */
function claimedReferences(text) {
  const out = []
  const re = /^\s{2}([a-zA-Z][\w]*)\s*!:\s*([\w.]+)/gm
  let m
  while ((m = re.exec(text))) out.push({ name: m[1], type: m[2] })
  return out
}

test('every sibling reference a scene system claims is wired by the orchestrator', () => {
  const orchestrator = fs.readFileSync(new URL(ORCHESTRATOR, SRC), 'utf8')
  const missing = []
  for (const file of systemFiles()) {
    const owner = ORCHESTRATOR_FIELDS[file.replace(/\.ts$/, '')]
    assert.ok(owner, `${file} is a scene system the wiring check does not know; add it to ORCHESTRATOR_FIELDS`)
    const text = fs.readFileSync(new URL(SYSTEMS + file, SRC), 'utf8')
    for (const ref of claimedReferences(text)) {
      // A claim whose type is one of the shared kit's own names (a context field
      // spelled out rather than left to `ctx`) still has to be assigned.
      const assignment = new RegExp(`this\\.${owner}\\.${ref.name}\\s*=`)
      if (!assignment.test(orchestrator)) missing.push(`${owner}.${ref.name} (${file}:${ref.type})`)
    }
  }
  assert.deepEqual(missing, [], `the orchestrator never assigns: ${missing.join(', ')}`)
})

test('the wiring check actually sees the claims it is guarding', () => {
  // A check that parsed nothing would pass forever, which is worse than no check.
  const level = fs.readFileSync(new URL(SYSTEMS + 'LevelSystem.ts', SRC), 'utf8')
  const names = claimedReferences(level).map((r) => r.name)
  assert.ok(names.includes('chunks'), 'LevelSystem claims the chunk meshes it slices')
  assert.ok(names.includes('modules'), 'and the fixtures')
  assert.ok(names.includes('trains'), 'and the consists')
  const section = fs.readFileSync(new URL(SYSTEMS + 'SectionSystem.ts', SRC), 'utf8')
  assert.ok(claimedReferences(section).map((r) => r.name).includes('crowd'), 'SectionSystem claims the crowd it clips')
})
