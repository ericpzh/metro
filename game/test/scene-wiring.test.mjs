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

test('population edits return before scene invalidation and tool geometry preparation', () => {
  const viewport = fs.readFileSync(new URL('app/Viewport.tsx', SRC), 'utf8')
  assert.match(viewport,/\[zoneOverlayOn, geometryVersion, activeZ\]/)
  assert.match(viewport,/\[moveKey, moveId, geometryVersion, tools\]/)
  const effect = viewport.slice(viewport.indexOf('const renderedStationRef'), viewport.indexOf('// A lifted piece'))
  assert.match(effect, /previous\.signVersion === signVersion && previous\.language === language/)
  assert.match(effect, /if \(scene.updatePopulationData\(data\)\) \{\s*geometryRef.current.resolve\(data\)\s*return/)
  assert.ok(effect.indexOf('populationEdit(previous.station, station)') < effect.indexOf('scene.setStation'))
})

test('pointer preview coalescing preserves touch/delete paths, flushes release and cancels unmount work', () => {
  const viewport = fs.readFileSync(new URL('app/Viewport.tsx', SRC), 'utf8')
  const moves = viewport.slice(viewport.indexOf('const onPointerMove ='), viewport.indexOf('const onPointerUp ='))
  assert.match(moves, /e\.pointerType === 'touch' \|\| dragRef\.current\?\.modules !== undefined/, 'touch gestures and deletion sweeps retain every path sample')
  assert.match(moves, /pointerFrame\.current\.flush\(\)\s*handlePointerMove\(e\)/, 'preserved paths drain an older queued sample before delivering the new one')
  assert.match(moves, /else pointerFrame\.current\.schedule\(\(\) => \{\s*handlePointerMove\(e\)\s*if \(pointerFrame\.current\.inAnimationFrame\) tools\.block\.flushFramePreview\(\)/, 'preview work finishes in the current pointer frame without an extra frame delay')
  assert.match(viewport, /const onPointerUp = [^{]+\{\s*pointerFrame\.current\.flush\(\)/, 'release processes the latest drag position before committing')
  assert.match(viewport, /useEffect\(\(\) => \(\) => \{\s*pointerFrame\.current\.cancel\(\)\s*tools\.block\.cancelPreview\(\)\s*\}, \[tools\]\)/, 'an unmounted viewport cannot deliver a stale preview')
})

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
  ClockSystem: 'clocks',
  RoadTrafficSystem: 'roads',
  SectionSystem: 'sectionSys',
  SkySystem: 'sky',
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

test('a boards-only sign preview rebuilds one sign and skips the chunk remesh', () => {
  // `SceneRenderer` needs WebGL to construct, so the fast path it takes for a
  // sign-board preview is pinned as a source contract: the unit below
  // (`performance-policy`) covers the pure pieces — the one-sign verdict, the
  // keep-set rebuild and the in-place plate repaint — and this covers that
  // `setStation` actually asks for them. Inert decor (floor stickers, wall
  // panels, hanging fittings that `buildGraph` never reads) takes the same
  // bargain with its own keep-set.
  const renderer = fs.readFileSync(new URL(ORCHESTRATOR, SRC), 'utf8')
  const body = renderer.slice(renderer.indexOf('setStation(data: StationData'), renderer.indexOf('defaultSection('))
  assert.ok(body.includes('signBoardsOnlyChanged'), 'a preview is checked for the one sign it belongs to')
  assert.ok(body.includes('equipmentOnlyChanged'), 'and equipment edits are classified independently of simulation routing')
  assert.match(body, /if \(signOnly !== null \|\| equipmentOnly\) this\.ctx\.stationData = data\s*else this\.chunks\.prepareStation\(data, effective, groundOnly\)/,
    'equipment-only edits update the document without rebuilding map-wide chunk inputs')
  assert.ok(body.includes('this.chunks.meshStation(groundOnly)'), 'window-only edits retain authored chunks')
  assert.match(body, /redrawSignPlates\(previousData \?\? undefined\)/, 'structural edits compare signage inputs before repainting')
  assert.ok(body.includes('signOnly === null && !equipmentOnly'), 'only a fuller change remeshes the chunks')
  assert.ok(body.includes('signOnly === null && !equipmentOnly && !retainedModules'), 'station-wide plate repaints stay on the full path')
  assert.ok(body.includes('id !== signOnly'), 'the module rebuild retains everything but that sign')
  assert.ok(/if \(signOnly !== null\) this\.repaintSignPreview\(data, signOnly\)/.test(body), 'and its plates are repainted in place')
  assert.ok(
    body.includes('(signOnly !== null || equipmentOnly) && !retainedModules) this.ctx.levelKey = '),
    'both fast paths skip the remesh that clears the slice key, so they clear it '
    + 'themselves — otherwise the trailing applyLevel early-outs, batch resync never '
    + 'runs, and a deleted shelf keeps drawing its batched body until a reload',
  )
})

test('an orbit re-aims the wall ghost: the renderer announces the camera aim and the viewport rebuilds on it', () => {
  // A wall-mounted piece hangs on the wall the camera is looking at
  // (`autofaceWallMount`), so *moving the camera* changes a ghost the pointer never
  // touched — the settings-driven refresh (`placementPreviewKey`) knows nothing
  // about the view. `SceneRenderer` cannot be constructed without WebGL, so the two
  // halves of that wiring are pinned as source contracts: the renderer notices the
  // aim has moved, and the viewport re-aims the equipment and 移动 ghosts when it has.
  const renderer = fs.readFileSync(new URL(ORCHESTRATOR, SRC), 'utf8')
  assert.ok(
    /onCameraAim: \(\(facing: readonly \[number, number\]\) => void\) \| null = null/.test(renderer),
    'the renderer offers the aim callback',
  )
  assert.ok(renderer.includes('this.notifyCameraAim()'), 'and asks it once a frame')
  const notify = renderer.slice(renderer.indexOf('private notifyCameraAim'), renderer.indexOf('resize(w: number, h: number)'))
  assert.ok(notify.includes('this.cameraSys.pickFacing()'), 'the aim is the camera’s own')
  assert.ok(notify.includes('this.onCameraAim(aim)'), 'and only a real move notifies')
  assert.ok(/Math\.abs\(aim\[0\] - this\.lastAim\[0\]\) <= 1e-3/.test(notify), 'a still camera notifies nobody')
  const viewport = fs.readFileSync(new URL('app/Viewport.tsx', SRC), 'utf8')
  const wired = viewport.slice(viewport.indexOf('scene.onCameraAim = '), viewport.indexOf('const resize = '))
  assert.ok(wired.includes('tools.equipment.refreshHover()'), 'the equipment ghost rebuilds on the new aim')
  assert.ok(wired.includes('tools.move.refreshHover()'), 'and so does a piece in the air (移动)')
  assert.ok(wired.includes('st.followAgentId !== null'), 'never while the crowd drives the camera')
  assert.ok(wired.includes('dragRef.current'), 'and never under a drag, which owns the pointer')
})
