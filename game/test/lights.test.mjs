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
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { sameSweepFamily } from '../src/app/sweep.ts'

const mat = new THREE.MeshStandardMaterial()
const ctx = { mats: { steel: mat }, data: { cells: [], modules: [], lines: [] } }
const close = (a, b, why = '') => assert.ok(Math.abs(a - b) < 1e-6, `${a} should equal ${b} ${why}`)

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

test('a light hangs from the real slab, and from its own line when the player aimed at one', () => {
  // The 4 m **grid line** used to be the light's ceiling: on a 基准高度-1 station the slab is
  // at 9 and the grid line at 8, so every light floated a metre below its ceiling, and a
  // taller room's floated in mid-air. A light reads the **slab over it** now — and a light
  // the player hung at a height they aimed at (`cfg.line`) hangs from that line instead.
  const cells = [{ x: 2, y: 3, z: 5, fill: 'solid' }, { x: 2, y: 3, z: 9, fill: 'solid' }]
  const ctx2 = { mats: { steel: mat }, data: { cells, modules: [], lines: [] } }
  const flush = createModule('light-circular', 2, 3, 5, 'l')
  close(new THREE.Box3().setFromObject(new LightModel(ctx2).build(flush)).max.z, 9, 'flush under the shifted station’s slab')
  // A taller room: with no slab at 9 the light reaches the one at 10, not the 4 m line at 8.
  const tall = { mats: { steel: mat }, data: { cells: [{ x: 2, y: 3, z: 5, fill: 'solid' }, { x: 2, y: 3, z: 10, fill: 'solid' }], modules: [], lines: [] } }
  close(new THREE.Box3().setFromObject(new LightModel(tall).build(flush)).max.z, 10, 'flush under a five-metre room’s slab')
  // Aimed at a height: the housing sits just under the line and needs no slab at all.
  const hung = createModule('light-circular', 2, 3, 6, 'l2')
  hung.cfg.line = 7
  close(new THREE.Box3().setFromObject(new LightModel({ mats: { steel: mat }, data: { cells: [], modules: [], lines: [] } }).build(hung)).max.z, 7, 'hung where it was put')
})

test('the tool hangs a flush fitting at the height the pointer is on', () => {
  // The aiming half (`EquipmentTool.ceilingPlacement` → `flushCeilingAim`): a surface the
  // pointer is on names a line and the fitting is built under it with that line in its
  // `cfg`; a floor leaves it to the slab overhead — which is the difference between hanging
  // a lamp where you point and hanging it in the room.
  const before = useStore.getState()
  try {
    const cells = [
      { x: 0, y: 1, z: 0, fill: 'solid' }, // the storey floor
      { x: 0, y: 1, z: 2, fill: 'solid' }, // a course to hang under
      { x: 0, y: 1, z: 4, fill: 'solid' }, // and the slab over the room
    ]
    useStore.setState({
      station: toState({ name: 'lights', seed: 1, cells, modules: [], lines: [] }),
      tool: 'module',
      moduleType: 'light-circular',
      moduleRot: 0,
    })
    const tool = new EquipmentTool({ scene: () => null, hover: { current: null }, drag: { current: null } })
    // Aimed at the underside of the block at (0, 1, 2): hung from that line, one cell below.
    const hung = tool.ceilingPlacement([0, 1, 2], [0, 1, 1], 'l1')
    assert.equal(hung.noCeiling, false, 'a line-hung fitting needs no slab')
    assert.deepEqual([hung.mods[0].x, hung.mods[0].y, hung.mods[0].z], [0, 1, 1], 'in the cell under the surface')
    assert.equal(hung.mods[0].cfg.line, 2, 'hung from the line the pointer was on')
    // Aimed at the floor: no line of its own, so it hangs from the room's ceiling.
    const room = tool.ceilingPlacement([0, 1, 0], [0, 1, 1], 'l2')
    assert.equal(room.noCeiling, false)
    assert.deepEqual([room.mods[0].x, room.mods[0].y, room.mods[0].z], [0, 1, 0])
    assert.equal(room.mods[0].cfg.line, undefined, 'a floor aim leaves it to the slab overhead')
  } finally {
    useStore.setState(before)
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
