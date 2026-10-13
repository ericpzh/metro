// Passenger concept-art capture (`src/app/capturePassengers.ts`, GAME-SPEC §9.5).
//
// The sheets photograph the live crowd mesh headless: `?capture-passengers`
// serves the capture, `tools/render-passenger-cards.mjs` saves its output, and
// `tools/passenger-cards.mjs` places the figures. Nothing here needs WebGL, so
// the contract is pinned as source, the way `scene-wiring` pins the
// orchestrator: the wiring that exposes the capture, the live mesh it
// photographs, and every field the sheet tools read. A capture that drifts off
// the crowd mesh — or drops a field the tools place by — fails here instead of
// printing wrong-scale figures, figures floating off their feet, or an
// animation with a NaN duration that never runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)
const read = (path) => readFileSync(new URL(path, SRC), 'utf8')
const REPO = new URL('../../', import.meta.url)
const readTool = (path) => readFileSync(new URL(`tools/${path}`, REPO), 'utf8')

test('the capture route exposes the passenger capture once it is ready', () => {
  const boot = read('main.tsx')
  assert.ok(boot.includes("params.has('capture-passengers')"), 'the capture route is missing')
  assert.match(boot, /import\('\.\/app\/capturePassengers\.ts'\)/)
  assert.ok(boot.includes('__passengerCards') && boot.includes('__passengerCardsReady'),
    'the headless run waits on __passengerCardsReady and calls __passengerCards')
  const driver = readTool('render-passenger-cards.mjs')
  assert.ok(driver.includes('!!window.__passengerCardsReady'), 'the driver must wait for readiness, not sleep')
  assert.ok(driver.includes('window.__passengerCards.capturePassengers()'), 'the index capture call is missing')
  assert.ok(driver.includes("capturePassengers({age:'child'})"), 'the art must capture smaller children as well as adult catalogue templates')
  assert.ok(driver.includes('walkCycles: true') && driver.includes('cycleView: view') && driver.includes('cycleHeading: heading'),
    'gait cycles must be captured in bounded camera/heading batches')
})

test('the capture photographs the live crowd mesh, with alpha', () => {
  const capture = read('app/capturePassengers.ts')
  // The same instanced mesh, pose atlas and appearance the crowd walks with —
  // a copy would freeze the sheets on old outfits while the station moves on.
  assert.match(capture, /from '\.\.\/render\/passengerModel\.ts'/)
  for (const name of ['passengerMesh', 'passengerAppearance']) {
    assert.ok(capture.includes(name), `the sheets must photograph the live ${name}`)
  }
  assert.ok(capture.includes('alpha: true') && capture.includes('setClearColor(0x000000, 0)'),
    'sheet figures are cut-outs: transparent capture, not a black card')
})

test('every field the sheet tools place by comes out of the capture', () => {
  const capture = read('app/capturePassengers.ts')
  const push = capture.slice(capture.indexOf('images.push({'))
  // `href` and `file` ride in as `png`: the driver saves each data URL to a file
  // and the sheet index swaps it for an href, so the capture's `png` is both fields.
  const produced = (field) => new RegExp(`\\b${field}\\b`).test(push)
    || ((field === 'href' || field === 'file') && /\bpng\b/.test(push))
  const used = new Set([...readTool('passenger-cards.mjs').matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))
  assert.ok(used.size > 0, 'the consumer field scan found nothing')
  for (const field of [...used].sort()) {
    assert.ok(produced(field), `tools/passenger-cards.mjs places by p.${field}, which the capture no longer emits`)
  }
  // `stride` is the model's own gait length, not a second copy of it: the sheet
  // divides it by path speed for the animation duration, so a missing or
  // hand-written value is a NaN animation — invisible walkers, no error.
  assert.ok(push.includes('stride: profile.stride * appearance[2]') && capture.includes('PASSENGER_WALK_PROFILES'), 'the gait cycle must follow the physical stride after fore/aft size scaling')
  // The driver turns each data URL into the file the sheets place by.
  assert.ok(readTool('render-passenger-cards.mjs').includes('Buffer.from(png.split'),
    'the driver must save capture pngs to the files the sheets read')
  // Placement is foot-anchored at metre scale: the sheet offsets by the
  // projected origin and scales by pixels-per-metre.
  assert.ok(push.includes('origin') && push.includes('pixelsPerMetre'), 'foot origin and scale are the placement contract')
})

test('the gait-cycle capture covers each sheet camera and one full stride', () => {
  const capture = read('app/capturePassengers.ts')
  assert.match(capture, /walkCycles\?: boolean/, 'the driver calls with {walkCycles:true}: the option must exist')
  assert.ok(!capture.includes("if (cycles && view !== 'plan') continue"),
    'isometric and elevation movers need their own camera captures, not rotated plan images')
  assert.ok(capture.includes("view === 'iso'") && capture.includes('i * Math.PI / 4')
    && capture.includes("view === 'elevation' ? [0, Math.PI] : [0]"),
    'isometric walkers need eight headings; elevation walkers face left or right')
  assert.ok(capture.includes('sample < (cycles ? PASSENGER_WALK_FRAMES : 4)'),
    'a gait capture sweeps the whole baked walk cycle, not the four preview samples')
  assert.ok(capture.includes('const walking = cycles || sample !== 0') && capture.includes('heading = cycleHeading ??'),
    'every gait frame walks at the captured heading, with one stable identity across its stride')
})


test('capture includes every model and bounds optional walking batches without a fixed catalogue limit', () => {
  const capture = read('app/capturePassengers.ts'), driver = readTool('render-passenger-cards.mjs')
  assert.ok(capture.includes('variant < PASSENGER_OUTFITS.length'))
  assert.ok(!capture.includes('variant % 3'), 'the old subset must not exclude newly approved models')
  assert.ok(capture.includes('options.cycleVariants.includes(variant)'))
  assert.ok(capture.includes('model: PASSENGER_OUTFITS[variant]'))
  assert.ok(capture.includes('sourceSha256: PASSENGER_LIBRARY[variant].sourceSha256'))
  assert.ok(driver.includes('passengerCaptureBatches') && driver.includes('validatePassengerCaptures'))
  const sprites = readTool('passenger-cards.mjs'), iso = readTool('iso.mjs')
  assert.ok(sprites.includes('length: passengerSpriteCount()'))
  assert.ok(iso.includes('identity % passengerSpriteCount()'), 'the static pool grows with future models')
})
