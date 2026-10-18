import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildTrackCatenary } from '../src/render/models/pieces/CatenaryModel.ts'
import { createModelMaterials, disposeModelMaterials, disposeObject } from '../src/render/models.ts'
import { trackHeadroom } from '../src/sim/track.ts'
import { trackClearanceBlocked } from '../src/build/rail.ts'
import { CONTACT_STRIP_Z, CONTACT_WIRE_Z } from '../src/sim/constants.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

function withKit(run) {
  const previous = globalThis.document
  globalThis.document = { createElement() { const c = { width: 0, height: 0 }; const { g } = stubCanvas(); g.canvas = c; c.getContext = () => g; return c } }
  const mats = createModelMaterials()
  try { run(mats) } finally { disposeModelMaterials(mats); globalThis.document = previous }
}
const track = (w, d, cfg) => ({ id: 'wire', type: 'track', x: 0, y: 0, z: 0, w, d, cfg: { line: '1', power: 'catenary', ...cfg } })
const named = (root, name) => root.children.filter(p => p.name === name)
const bounds = part => { part.updateMatrixWorld(true); return new THREE.Box3().setFromObject(part) }
const triangles = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3

for (const cfg of [{}, { tunnel: true }, { catenaryStyle: 'gantry' }, { bridge: true }]) {
  test(`catenary ${JSON.stringify(cfg)} retains contact, clearance and authored detail on short/long/wide runs`, () => withKit(mats => {
    for (const w of [1, 8, 17, 128]) for (const d of [3, 4]) {
      const root = new THREE.Group()
      buildTrackCatenary(root, mats, track(w, d, cfg))
      try {
        assert.ok(bounds(root).max.z <= trackHeadroom(track(w, d, cfg)) + 1, 'placement reserves the complete overhead assembly')
        const wire = named(root, 'catenary-contact-wire')[0]
        assert.ok(wire)
        const contact = bounds(wire)
        assert.ok(Math.abs(contact.min.z - CONTACT_STRIP_Z) < 1e-6)
        assert.ok(Math.abs(contact.min.x + .5) < 1e-6 && Math.abs(contact.max.x - (w - .5)) < 1e-6, 'wire reaches both module seams')
        assert.ok(Math.abs(contact.getCenter(new THREE.Vector3()).y - (d - 1) / 2) < 1e-6)
        const lowContact = wire.userData.lowDetailGeometry.clone().applyMatrix4(wire.matrix)
        lowContact.computeBoundingBox()
        assert.ok(Math.abs(lowContact.boundingBox.min.z - CONTACT_STRIP_Z) < 1e-6, 'Low wire still touches the carbon strip')
        lowContact.dispose()
        let high = 0, low = 0
        for (const part of root.children) {
          high += triangles(part.geometry)
          low += triangles(part.userData.lowDetailGeometry ?? part.geometry)
          if (!part.name.endsWith('gantry-post') && part !== wire) assert.ok(bounds(part).min.z >= CONTACT_STRIP_Z - 1e-6, `${part.name} clears the collector`)
        }
        assert.ok(low < high * .3, `authored Low ${low}/${high} triangles`)
        for (const rot of [0, 1, 2, 3]) {
          root.rotation.z = rot * Math.PI / 2
          root.position.z = -8
          root.updateMatrixWorld(true)
          assert.ok(Math.abs(bounds(wire).min.z - (CONTACT_STRIP_Z - 8)) < 1e-6)
        }
      } finally { disposeObject(root) }
    }
  }))
}

test('open catenary has sagging messenger spans, droppers, insulated registration arms and lattice portals', () => withKit(mats => {
  const root = new THREE.Group()
  buildTrackCatenary(root, mats, track(24, 3, { bridge: true }))
  try {
    assert.ok(named(root, 'catenary-messenger-wire').length >= 3)
    assert.ok(named(root, 'catenary-dropper').length >= 8)
    for (const name of ['catenary-return-wire', 'catenary-ribbed-insulator', 'catenary-registration-arm', 'catenary-support-brace', 'catenary-truss-chord', 'catenary-truss-web']) assert.ok(named(root, name).length, name)
    for (const part of named(root, 'catenary-messenger-wire')) {
      const positions = part.geometry.getAttribute('position')
      const zs = Array.from({ length: positions.count }, (_, i) => positions.getZ(i))
      assert.ok(Math.max(...zs) - Math.min(...zs) > .02, 'messenger sags; the contact wire does not')
      assert.ok(Math.min(...zs) > CONTACT_WIRE_Z + .20)
    }
    assert.equal(named(root, 'catenary-rigid-web').length, 0)
  } finally { disposeObject(root) }
}))

test('tunnel assembly fits below the crown and uses rigid flanges with wall cantilevers', () => withKit(mats => {
  const root = new THREE.Group()
  buildTrackCatenary(root, mats, track(16, 4, { tunnel: true }))
  try {
    assert.ok(bounds(root).max.z < 5)
    for (const name of ['catenary-rigid-flange', 'catenary-rigid-web', 'catenary-tunnel-wall-plate', 'catenary-tunnel-cantilever', 'catenary-tunnel-brace', 'catenary-ribbed-insulator']) assert.ok(named(root, name).length, name)
    assert.equal(named(root, 'catenary-messenger-wire').length, 0)
    const geometries = new Set()
    for (const part of root.children) { geometries.add(part.geometry); if (part.userData.lowDetailGeometry) geometries.add(part.userData.lowDetailGeometry) }
    const releases = new Map()
    for (const geometry of geometries) geometry.addEventListener('dispose', () => releases.set(geometry, (releases.get(geometry) ?? 0) + 1))
    disposeObject(root)
    for (const geometry of geometries) assert.equal(releases.get(geometry), 1, 'source and prepared Low geometry release exactly once')
  } finally { root.clear() }
}))


test('open gantries reserve their taller crossbeam while compact rigid rails keep the existing clearance', () => {
  for (const cfg of [{}, {tunnel:true}, {catenaryStyle:'gantry'}, {bridge:true}]) {
    const mod = track(8, 3, cfg)
    const state = {cells:[{x:0,y:0,z:5,fill:'solid'}],modules:[]}
    assert.equal(trackClearanceBlocked(state, mod), !cfg.tunnel && !!(cfg.bridge || cfg.catenaryStyle === 'gantry'))
  }
})


for (const bridge of [false, true]) test(`gantry joints seat every arm and crossbeam in solid hardware (bridge=${bridge})`, () => withKit(mats => {
  for (const d of [3, 4]) for (const rot of [0, 1, 2, 3]) {
    const root = new THREE.Group()
    buildTrackCatenary(root, mats, track(17, d, bridge ? {bridge:true} : {catenaryStyle:'gantry'}))
    root.position.set(12, -9, 4)
    root.rotation.z = rot * Math.PI / 2
    root.updateMatrixWorld(true)
    try {
      const posts = named(root, bridge ? 'bridge-gantry-post' : 'station-gantry-post').map(bounds)
      const mounts = named(root, 'catenary-arm-mount').map(bounds)
      assert.ok(mounts.length > 0)
      const endpoints = part => {
        const half = part.geometry.parameters.height / 2
        return [-half, half].map(y => new THREE.Vector3(0, y, 0).applyMatrix4(part.matrixWorld))
      }
      const arms = [...named(root, 'catenary-upper-stay'), ...named(root, 'catenary-registration-arm')]
      for (const mount of mounts) {
        assert.ok(posts.some(post => {
          const overlap = post.clone().intersect(mount).getSize(new THREE.Vector3())
          return overlap.x > .01 && overlap.y > .01 && overlap.z > .01
        }), 'mounting cleat physically overlaps the post in all three axes')
        assert.ok(arms.some(arm => endpoints(arm).some(point => mount.containsPoint(point))), 'an arm endpoint is seated inside each cleat')
      }
      for (const chord of named(root, 'catenary-truss-chord')) {
        for (const endpoint of endpoints(chord)) assert.ok(posts.some(post => post.containsPoint(endpoint)), 'both crossbeam ends are seated inside posts, including the upper chords')
      }
      // Cleats remain solid at Low; changing wire detail cannot reopen joints.
      for (const mount of named(root, 'catenary-arm-mount')) assert.ok(!mount.userData.lowDetailGeometry || triangles(mount.userData.lowDetailGeometry) > 0)
    } finally { disposeObject(root) }
  }
}))
