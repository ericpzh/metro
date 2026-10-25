import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { rampLengthsFor, rampSpanOf, defaultRampLength } from '../src/sim/rampLengths.ts'
import { escalatorModule, escalatorSpanOf, escalatorLength } from '../src/sim/escalators.ts'
import { stairFlightsFor, stairLengthOf } from '../src/sim/stairs.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'
import { moduleBuilderAttributes } from '../src/app/store/builderAttributes.ts'

test('three-storey ramps continue the two-storey range by 1–5 metres', () => {
  const lengths = rampLengthsFor('triple')
  const end = rampLengthsFor('double').at(-1).rise
  assert.deepEqual(lengths.map(s => s.rise - end), [1, 2, 3, 4, 5])
  assert.equal(lengths.find(s => s.id === defaultRampLength(5, 'triple')).rise, 15)
  for (const spec of lengths) for (let rot = 0; rot < 4; rot++) {
    const base = { x: 0, y: 0, z: -15 }
    for (const dir of ['up', 'down']) {
      const m = escalatorModule(base, rot, dir, 'e', 1, spec.id, 5, 'triple')
      assert.equal(Math.abs(m.to.z - m.from.z), spec.rise)
      assert.equal(escalatorSpanOf(m), 'triple')
      assert.equal(escalatorLength(m), spec.id)
    }
    for (const style of ['straight', 'right90', 'left90', 'right180', 'left180']) {
      const flights = stairFlightsFor(base, rot, style, undefined, spec.id, 5, 'triple')
      const m = { type: 'stair', from: flights[0].from, to: flights.at(-1).to, cfg: { flights } }
      assert.equal(m.to.z - m.from.z, spec.rise)
      assert.equal(rampSpanOf(m.to.z - m.from.z), 'triple')
      assert.equal(stairLengthOf(m), spec.id)
    }
  }
})

// Exercise the real straight-run builder, where bay snapping has a separate path.

test('single-run stair placement and snap dimensions use the selected storey family', () => {
  const before = useStore.getState()
  try {
    const tool = new EquipmentTool({})
    useStore.setState({ station: { ...before.station, modules: [] }, moduleType: 'stair', moduleRot: 0 })
    for (const span of ['single', 'double', 'triple']) for (const spec of rampLengthsFor(span)) {
      useStore.setState({ escalatorSpan: span, rampLength: spec.id, doubleRampLength: spec.id, tripleRampLength: spec.id })
      const state = useStore.getState()
      assert.ok(moduleBuilderAttributes('stair', state).some(a => a.kind === 'span'))
      assert.equal(tool.rampSnapSpec('stair').rise, spec.rise)
      const [m] = tool.buildPlacementModules('stair', [0, 0, -20], 'straight')
      assert.equal(m.to.z - m.from.z, spec.rise)
      assert.equal(Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), spec.run)
    }
  } finally { useStore.setState(before) }
})


test('stair span control cycles all three values and the tile highlights exactly one of three layers', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ moduleType: 'stair', escalatorSpan: 'single' })
    const spans = []
    for (let i = 0; i < 3; i++) {
      const s = useStore.getState()
      spans.push(s.escalatorSpan)
      const span = moduleBuilderAttributes('stair', s).find(a => a.kind === 'span')
      assert.ok(span)
      span.activate()
    }
    assert.deepEqual(spans, ['single', 'double', 'triple'])
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/app/rail/shared/AttributeArt.tsx'), 'utf8')
    assert.match(source, /\['M2 17 7 13h11l-5 4Z', 'M2 12 7 8h11l-5 4Z', 'M2 7 7 3h11l-5 4Z'\]/)
    assert.match(source, /fill=\{i === selected \? 'currentColor' : 'none'\}/)
  } finally { useStore.setState(before) }
})
