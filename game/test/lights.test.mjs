import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { LightModel } from '../src/render/models/pieces/LightModel.ts'
import { equipmentReason, moduleEnvelope, placementBlocked, movedModule } from '../src/sim/placement.ts'
import { pillarOffset } from '../src/sim/structures.ts'
import { lightOffset } from '../src/sim/lights.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { useStore } from '../src/app/store.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { sameSweepFamily } from '../src/app/sweep.ts'

const mat = new THREE.MeshStandardMaterial()
const ctx = { mats: { steel: mat }, data: { cells: [], modules: [], lines: [] } }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} should equal ${b}`)

test('the luminous face sits below the steel backing without coincident visible faces', () => {
  for (const variant of ['circular', 'rectangular']) for (const rot of [0, 1]) {
    const m = createModule(`light-${variant}`, 0, 0, 0, 'l', rot)
    const model = new LightModel(ctx).build(m)
    model.updateMatrixWorld(true)
    const housing = new THREE.Box3().setFromObject(model.children[0])
    const diffuser = new THREE.Box3().setFromObject(model.children[1])
    close(housing.max.z, 4)
    close(diffuser.max.z, housing.min.z)
    close(housing.min.z - diffuser.min.z, 0.01)
    assert.ok(diffuser.min.z < housing.min.z - 0.009, 'steel cannot compete with the emitting face in the depth buffer')
  }
})

test('each light touches its ceiling with no gap, with collision matching the drawn fixture', () => {
  for (const z of [-4, 0, 4, 1]) for (const variant of ['circular', 'rectangular']) {
    for (let position = 0; position < (variant === 'circular' ? 1 : 9); position++) for (let rot = 0; rot < (variant === 'circular' ? 1 : 2); rot++) {
      const m = createModule(`light-${variant}`, 2, 3, z, 'l', rot)
      m.cfg.position = position
      const bounds = new THREE.Box3().setFromObject(new LightModel(ctx).build(m))
      const envelope = moduleEnvelope(m)
      for (const axis of ['x', 'y', 'z']) {
        close(bounds.min[axis], envelope[`${axis}0`])
        close(bounds.max[axis], envelope[`${axis}1`])
      }
      assert.equal(envelope.z1, z < 0 ? 0 : z < 4 ? 4 : 8, 'housing top meets slab underside')
    }
  }
})

test('rectangular lights and slim pillars follow centre then top-left to bottom-right', () => {
  const order = [[0, 0], [-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1]]
  for (const type of ['pillar-slim', 'light-rectangular']) {
    useStore.setState({ moduleType: type, moduleRot: 0, lightPosition: 0 })
    for (let i = 0; i < 9; i++) {
      const m = createModule(type, 0, 0, 0, 'm', type === 'pillar-slim' ? i : 0)
      if (m.type === 'light') m.cfg.position = i
      const offset = type === 'pillar-slim' ? pillarOffset(m) : lightOffset(m)
      close(offset.x, order[i][0] * (type === 'pillar-slim' ? 0.35 : 0.1))
      close(offset.y, order[i][1] * (type === 'pillar-slim' ? 0.35 : 0.44))
      if (type === 'pillar-slim') useStore.getState().rotateModule()
      else useStore.getState().cycleLightPosition()
      assert.equal(type === 'pillar-slim' ? useStore.getState().moduleRot : useStore.getState().lightPosition, (i + 1) % 9)
    }
    if (type === 'pillar-slim') useStore.getState().setModuleRot(8)
    else useStore.getState().setLightPosition(8)
    assert.equal(type === 'pillar-slim' ? useStore.getState().moduleRot : useStore.getState().lightPosition, 8, 'picking preserves the last position')
  }
})

test('lights need a ceiling, share air above furniture, and refuse intersecting fixtures and pillars', () => {
  const light = createModule('light-circular', 0, 0, 0, 'l')
  const ceiling = [{ x: 0, y: 0, z: 4, fill: 'solid' }]
  assert.equal(equipmentReason([], [], light), 'ceiling')
  assert.equal(equipmentReason(ceiling, [], light), '')
  assert.equal(placementBlocked([createModule('bench', 0, 0, 0, 'b')], light), false)
  assert.equal(placementBlocked([createModule('pillar-slim', 0, 0, 0, 'p')], light), true)
  assert.equal(placementBlocked([light], { ...light, id: 'other' }), true)
  const edge = createModule('light-rectangular', 0, 0, 0, 'edge', 0)
  edge.cfg.position = 2
  assert.equal(placementBlocked([light], edge), false, 'separate fittings may occupy one ceiling tile')
})

test('variant and position survive save/load and refresh the ghost', () => {
  const a = createModule('light-circular', 0, 0, 0, 'a')
  const b = createModule('light-rectangular', 1, 0, 0, 'b', 1)
  b.cfg.position = 8
  const state = toState({ name: 'Lights', seed: 1, cells: [], modules: [a, b], lines: [] })
  assert.deepEqual(parse(serialize(state)).state.modules, [a, b])
  assert.notEqual(moduleGhostKey(a), moduleGhostKey({ ...a, cfg: b.cfg }))
  assert.notEqual(moduleGhostKey(b), moduleGhostKey({ ...b, rot: 0 }))
  assert.equal(sameSweepFamily(a, b), false)
  assert.equal(sameSweepFamily(b, { ...b, id: 'c', rot: 2 }), true)
})

test('moving a rectangular light toggles orientation and preserves its position', () => {
  const light = createModule('light-rectangular', 0, 0, 0, 'l', 1)
  light.cfg.position = 8
  useStore.setState({ station: toState({ name: 'Lights', seed: 1, cells: [], modules: [light], lines: [] }), moveDraft: null })
  useStore.getState().liftModule(light.id)
  assert.equal(useStore.getState().moveDraft.rot, 1)
  assert.equal(useStore.getState().moveDraft.module.cfg.position, 8)
  useStore.getState().rotateMove()
  assert.equal(useStore.getState().moveDraft.rot, 0)
  useStore.getState().rotateMove()
  assert.equal(useStore.getState().moveDraft.rot, 1)
  const at = { x: 1, y: 0, z: 0 }
  useStore.getState().aimMove(at, movedModule(light, at, 1), '')
  useStore.getState().cycleMoveLightPosition()
  const d = useStore.getState().moveDraft
  assert.equal(d.module.cfg.position, 0)
  useStore.getState().aimMove(at, movedModule(d.module, at, d.rot), '')
  assert.equal(useStore.getState().moveDraft.candidate.cfg.position, 0, 'same-cell aim refreshes after Tab')
  useStore.getState().cancelMove(false)
})


test('R switches 0/90 independently of the Tab position cycle', () => {
  useStore.setState({ moduleType: 'light-rectangular', moduleRot: 0, lightPosition: 8 })
  useStore.getState().rotateModule()
  assert.equal(useStore.getState().moduleRot, 1)
  assert.equal(useStore.getState().lightPosition, 8)
  useStore.getState().rotateModule()
  assert.equal(useStore.getState().moduleRot, 0)
  useStore.getState().cycleLightPosition()
  assert.equal(useStore.getState().lightPosition, 0)
  assert.equal(useStore.getState().moduleRot, 0)
})
