// 第三轨 side: travel left, off the platform side at a station (§5.4).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

const stubCanvas = () => ({ width: 0, height: 0, getContext: () => stubContext() })
function stubContext() {
  const store = {}
  return new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key]
      if (key === 'measureText') return (text) => ({ width: String(text ?? '').length * 8 })
      if (key === 'canvas') return stubCanvas()
      return () => undefined
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}
globalThis.document = globalThis.document ?? { createElement: () => stubCanvas() }

const { thirdRailSide } = await import('../src/sim/track.ts')
const { buildModule, createModelMaterials } = await import('../src/render/models.ts')

const track = (cfg, rot = 0) => ({ id: 'track-1', type: 'track', x: 4, y: 4, z: 0, w: 8, d: 3, rot, cfg: { line: '5', power: 'third-rail', dir: 'up', ...cfg } })
const edge = (side, from = 'track-1', dir = 'up') => ({ id: `edge-${side}-${from}`, type: 'platform-edge', x: 4, y: 4, z: 0, w: 8, rot: 0, cfg: { name: '站台门', line: '5', dir, side, psd: 'full', from } })

test('tunnel and bridge keep the travel left whatever screens exist', () => {
  const both = [edge('left'), edge('right')]
  assert.equal(thirdRailSide(track({ tunnel: true, dir: 'up' }), both), 1, 'tunnel up is local +y (facing +x, left is +y)')
  assert.equal(thirdRailSide(track({ tunnel: true, dir: 'down' }), both), -1, 'tunnel down is local −y (facing −x, left is −y)')
  assert.equal(thirdRailSide(track({ bridge: true, dir: 'up' }), both), 1, 'bridge up is local +y')
  assert.equal(thirdRailSide(track({ bridge: true, dir: 'down' }), both), -1, 'bridge down is local −y')
})

test('platform rail without screens falls back to the travel left', () => {
  assert.equal(thirdRailSide(track({ dir: 'up' }), []), 1, 'up with no screens is +y')
  assert.equal(thirdRailSide(track({ dir: 'down' }), []), -1, 'down with no screens is −y')
})

test('platform rail with one screen takes the side with no 屏蔽门', () => {
  // A left edge means the platform sits past the bed at local +y, so the rail goes −y.
  assert.equal(thirdRailSide(track({ dir: 'up' }), [edge('left')]), -1, 'up, platform on +y → rail on −y')
  assert.equal(thirdRailSide(track({ dir: 'down' }), [edge('left')]), -1, 'down, platform on +y → rail on −y')
  // A right edge is the mirror image.
  assert.equal(thirdRailSide(track({ dir: 'up' }), [edge('right')]), 1, 'up, platform on −y → rail on +y')
  assert.equal(thirdRailSide(track({ dir: 'down' }), [edge('right')]), 1, 'down, platform on −y → rail on +y')
})

test('platform rail with screens on both sides uses the travel left', () => {
  const both = [edge('left'), edge('right')]
  assert.equal(thirdRailSide(track({ dir: 'up' }), both), 1, 'both sides → up keeps +y')
  assert.equal(thirdRailSide(track({ dir: 'down' }), both), -1, 'both sides → down keeps −y')
})

test('only the rail’s own screens count, including legacy direction-matched edges', () => {
  const other = edge('left', 'track-9')
  assert.equal(thirdRailSide(track({ dir: 'up' }), [other]), 1, 'another rail’s screens do not move this rail')
  const legacy = { id: 'edge-legacy', type: 'platform-edge', x: 4, y: 4, z: 0, w: 8, rot: 0, cfg: { name: '站台门', line: '5', dir: 'up', side: 'left', psd: 'full' } }
  assert.equal(thirdRailSide(track({ dir: 'up' }), [legacy]), -1, 'a legacy edge without from still names the platform side')
  const legacyOtherDir = { ...legacy, id: 'edge-legacy-2', cfg: { ...legacy.cfg, dir: 'down' } }
  assert.equal(thirdRailSide(track({ dir: 'up' }), [legacyOtherDir]), 1, 'a legacy edge for the other direction is ignored')
})

test('the side is local, so rotation never moves it, and an unset dir falls back to the line', () => {
  for (const rot of [0, 1, 2, 3]) {
    assert.equal(thirdRailSide(track({ dir: 'up', tunnel: true }, rot), []), 1, `tunnel up stays local +y at rot ${rot}`)
    assert.equal(thirdRailSide(track({ dir: 'down', tunnel: true }, rot), []), -1, `tunnel down stays local −y at rot ${rot}`)
    assert.equal(thirdRailSide(track({ dir: 'up' }, rot), [edge('left')]), -1, `platform up with a +y platform stays −y at rot ${rot}`)
  }
  const noDir = { id: 'track-1', type: 'track', x: 4, y: 4, z: 0, w: 8, d: 3, rot: 0, cfg: { line: '5', power: 'third-rail' } }
  assert.equal(thirdRailSide(noDir, [], 'down'), -1, 'an unset cfg.dir falls back to the line direction')
  assert.equal(thirdRailSide(noDir, []), 1, 'with no line direction either, up is the default')
})

test('a tunnel ignores even a single-sided screen', () => {
  assert.equal(thirdRailSide(track({ tunnel: true, dir: 'up' }), [edge('left')]), 1, 'tunnel up keeps +y past a +y platform')
  assert.equal(thirdRailSide(track({ bridge: true, dir: 'down' }), [edge('right')]), -1, 'bridge down keeps −y past a −y platform')
})

const LINE = { id: '5', name: '5号线', colour: '#c8102e', stock: 'B', cars: 6, power: 'third-rail', psd: 'full', headwayProfile: { peak: 150, offpeak: 240, late: 480 }, alightPerTrain: 420, terminus: 'through', direction: 'up', upTerminus: '', downTerminus: '', travelSign: 1, stations: [] }
const mats = createModelMaterials()
const adsStub = { adFace: (slug, w, h) => ({ material: new THREE.MeshBasicMaterial(), geometry: new THREE.PlaneGeometry(w, h), slug }), adWindow: (w, h) => adsStub.adFace('x', w, h), load: async () => {}, dispose: () => {} }

function thirdRailMeanY(mod, modules) {
  const data = { name: 't', seed: 1, cells: [], modules, lines: [LINE] }
  const ctx = { mats, ads: adsStub, data, trackCells: new Set(), tvPlate: () => new THREE.CanvasTexture(stubCanvas()), signFace: () => new THREE.MeshBasicMaterial(), finish: () => mats.steel, preview: false }
  const group = buildModule(mod, ctx)
  assert.ok(group, 'the track builds')
  const cy = ((mod.d ?? 1) - 1) / 2
  const ys = []
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return
    if (o.material !== mats.psu) return
    ys.push(o.position.y)
  })
  assert.ok(ys.length > 0, 'the third rail draws its yellow cover')
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length
  return { mean, cy }
}

test('the drawn conductor rail follows the same side', () => {
  const up = track({ dir: 'up' })
  let r = thirdRailMeanY(up, [up])
  assert.ok(r.mean > r.cy, 'up with no screens draws on local +y')

  const down = track({ dir: 'down' })
  r = thirdRailMeanY(down, [down])
  assert.ok(r.mean < r.cy, 'down with no screens draws on local −y')

  const upLeft = track({ dir: 'up' })
  r = thirdRailMeanY(upLeft, [upLeft, edge('left')])
  assert.ok(r.mean < r.cy, 'up with a +y platform draws on −y, away from the screens')

  const tunnelUp = track({ dir: 'up', tunnel: true })
  r = thirdRailMeanY(tunnelUp, [tunnelUp, edge('left')])
  assert.ok(r.mean > r.cy, 'a tunnel keeps the travel left even past a platform')

  const bridgeDown = track({ dir: 'down', bridge: true })
  r = thirdRailMeanY(bridgeDown, [bridgeDown, edge('right')])
  assert.ok(r.mean < r.cy, 'a bridge keeps the travel left even past a platform')

  const islandUp = track({ dir: 'up' })
  r = thirdRailMeanY(islandUp, [islandUp, edge('left'), edge('right')])
  assert.ok(r.mean > r.cy, 'an island platform falls back to the travel left')
})
