import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { parse, serialize } from '../src/persistence/save.ts'
import { toData } from '../src/build/model.ts'
import { trackCeilingUnderside } from '../src/sim/track.ts'
import { CABIN_FLOOR_Z, trainOriginForScale, trainScaleForStorey } from '../src/sim/stock.ts'
import { buildModule, buildTrain, createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const source = readFileSync(new URL('./fixtures/covered-rail-clearance.metro.json', import.meta.url), 'utf8')

test('PSD safety stickers fit compact glass with clear gaps between the warning, arrow and band', () => {
  const previous = globalThis.document
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0 }
    const { g } = stubCanvas(); g.canvas = canvas
    canvas.getContext = () => g
    return canvas
  } }
  const mats = createModelMaterials()
  try {
    for (const stock of ['A', 'B', 'C', 'D', 'L']) for (const side of ['left', 'right']) {
      const result = parse(source)
      const data = toData(result.state)
      data.lines[0].stock = stock
      const edge = data.modules.find(m => m.type === 'platform-edge')
      edge.cfg.side = side
      const group = buildModule(edge, { data, mats, trackCells: new Set(), finish: () => mats.steel, owned: [] })
      try {
        const named = name => group.children.filter(m => m.name === name)
        const box = mesh => { mesh.updateWorldMatrix(true, false); return new THREE.Box3().setFromObject(mesh) }
        const glass = named('psd-door-glass')
        assert.ok(glass.length > 0)
        for (const name of ['psd-door-warning', 'psd-door-arrow', 'psd-door-band']) {
          const decals = named(name)
          assert.equal(decals.length, glass.length)
          decals.forEach((decal, i) => {
            const d = box(decal), pane = box(glass[i])
            assert.ok(d.min.x >= pane.min.x - 1e-6 && d.max.x <= pane.max.x + 1e-6, `${stock}: sticker fits leaf width`)
            assert.ok(d.min.z > pane.min.z + .06 && d.max.z < pane.max.z - .06, `${stock}: sticker clears glass rails`)
          })
        }
        assert.ok(box(named('psd-door-warning')[0]).min.z > box(named('psd-door-arrow')[0]).max.z)
        assert.ok(box(named('psd-door-arrow')[0]).min.z > box(named('psd-door-band')[0]).max.z)
        assert.ok(Math.abs(box(named('psd-door-band')[0]).min.z - box(named('psd-fixed-band')[0]).min.z) < 1e-6)
      } finally { disposeObject(group) }
    }
  } finally { disposeModelMaterials(mats); globalThis.document = previous }
})

test('the five-metre save opens without moving its authored blocks', () => {
  const original = JSON.parse(source)
  const result = parse(source)
  assert.ok(result.ok)
  assert.equal(result.state.storeyHeight, 5)
  assert.deepEqual(result.state.cells, original.static.cells)
  assert.deepEqual(result.state.modules.map(m => [m.id, m.x, m.y, m.z]), original.static.modules.map(m => [m.id, m.x, m.y, m.z]))
  assert.equal(parse(serialize(result.state)).state.storeyHeight, 5)
})

test('the saved two-level station fits the train and rigid wire below each ceiling underside', () => {
  const result = parse(source)
  assert.ok(result.ok)
  const data = toData(result.state)
  const previous = globalThis.document
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0 }
    const { g } = stubCanvas()
    g.canvas = canvas
    canvas.getContext = () => g
    return canvas
  } }
  const mats = createModelMaterials()
  const bounds = root => { root.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(root) }
  try {
    for (const track of data.modules.filter(m => m.type === 'track')) {
      const ceiling = trackCeilingUnderside(track, data.cells)
      assert.equal(ceiling, track.z + 4)
      const rail = buildModule(track, { data, mats, trackCells: new Set(), finish: () => mats.steel, owned: [] })
      const scale = trainScaleForStorey(data.storeyHeight)
      const train = buildTrain(mats, {
        x: track.x + track.w / 2, y: track.y + track.d / 2,
        z: track.z + trainOriginForScale(scale), modelScale: scale,
        stock: 'A', cars: 2, power: 'catenary', colour: '#edcf3b', dirSign: 1, yaw: 0, doorsOpen: false,
      })
      try {
        assert.equal(train.position.z + CABIN_FLOOR_Z * scale, track.z + 1)
        const concrete = bounds(rail.getObjectByName('track-bed'))
        assert.ok(Math.abs(concrete.min.z - (track.z - 1)) < 1e-6, 'concrete fills the full lower block beneath the rails')
        assert.ok(Math.abs(concrete.min.x - track.x) < 1e-6 && Math.abs(concrete.max.x - track.x - track.w) < 1e-6)
        assert.ok(Math.abs(concrete.min.y - track.y) < 1e-6 && Math.abs(concrete.max.y - track.y - track.d) < 1e-6)
        assert.equal(rail.getObjectByName('catenary-canopy'), undefined)
        const wire = bounds(rail.getObjectByName('catenary-contact-wire'))
        assert.ok(Math.abs(wire.min.z - (track.z + 3.891)) < 1e-6)
        assert.ok(bounds(rail).max.z <= ceiling + 1e-6, 'no bracket attaches to the top of the ceiling block')
        assert.ok(bounds(train).max.z < ceiling, 'the entire train and collector clear the slab')
        const plate = bounds(rail.getObjectByName('catenary-ceiling-plate'))
        assert.ok(Math.abs(plate.max.z - ceiling) < 1e-6, 'hanger touches the slab underside')
        train.traverse(part => {
          if (part.name === 'pantograph-contact-strip') assert.ok(Math.abs(bounds(part).max.z - wire.min.z) < 1e-6)
        })
        const edge = data.modules.find(m => m.type === 'platform-edge' && m.cfg.from === track.id)
        const screen = buildModule(edge, { data, mats, trackCells: new Set(), finish: () => mats.steel, owned: [] })
        try { assert.ok(Math.abs(bounds(screen).max.z - ceiling) < 1e-6, 'full PSD meets the same ceiling underside') }
        finally { disposeObject(screen) }
      } finally { disposeObject(rail); disposeObject(train) }
    }
  } finally { disposeModelMaterials(mats); globalThis.document = previous }
})

test('ceiling detection uses the lower face of an actual slab instead of its upper face', () => {
  const track = { id: 'rail', type: 'track', x: 0, y: 0, z: 8, w: 4, d: 3, rot: 0, storeyHeight: 5, cfg: { line: '1', power: 'catenary' } }
  assert.equal(trackCeilingUnderside(track, [{ x: 1, y: 1, z: 11, fill: 'solid' }]), 11)
  assert.equal(trackCeilingUnderside(track, [{ x: 1, y: 1, z: 12, fill: 'solid' }]), 12)
  assert.equal(trackCeilingUnderside(track, [{ x: 1, y: 1, z: 17, fill: 'solid' }]), 12, 'a higher storey cannot pull this wire upward')
})
