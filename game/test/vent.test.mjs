import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { VentModel } from '../src/render/models/pieces/VentModel.ts'
import { equipmentReason, moduleEnvelope, placementBlocked, isMovableModule } from '../src/sim/placement.ts'
import { folderTiles, isDecorType } from '../src/app/store/catalog.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { sameSweepFamily } from '../src/app/sweep.ts'

const mat = new THREE.MeshStandardMaterial()
const ctx = { mats: { steel: mat, black: mat }, data: { cells: [], modules: [], lines: [] } }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6)

test('vent is its own decor tile, movable, sweepable, and preserved in saves', () => {
  const vent = createModule('vent', 0, 0, 0, 'vent', 1)
  assert.equal(vent.type, 'vent')
  assert.equal(isDecorType('vent'), true)
  assert.ok(folderTiles('decor').some((t) => t.kind !== 'family' && t.option.id === 'vent'))
  assert.equal(isMovableModule(vent), true)
  assert.equal(sameSweepFamily(vent, { ...vent, id: 'next', rot: 0 }), true)
  assert.equal(sameSweepFamily(vent, createModule('light-circular', 0, 0, 0, 'light')), false)
  const state = toState({ name: 'Vents', seed: 1, cells: [], modules: [vent], lines: [] })
  assert.deepEqual(parse(serialize(state)).state.modules, [vent])
})

test('the grille touches the ceiling and matches its collision bounds at every rotation', () => {
  for (const z of [-4, 0, 4]) for (let rot = 0; rot < 4; rot++) {
    const vent = createModule('vent', 2, 3, z, 'vent', rot)
    const model = new VentModel(ctx).build(vent)
    const bounds = new THREE.Box3().setFromObject(model)
    const envelope = moduleEnvelope(vent)
    for (const axis of ['x', 'y', 'z']) {
      close(bounds.min[axis], envelope[`${axis}0`])
      close(bounds.max[axis], envelope[`${axis}1`])
    }
    close(bounds.max.z, z + 4)
    const backing = new THREE.Box3().setFromObject(model.children[4])
    for (const blade of model.children.slice(5)) {
      const box = new THREE.Box3().setFromObject(blade)
      assert.ok(box.max.z < backing.min.z - 0.01, 'recessed dark backing cannot flicker against the grille blades')
    }
  }
})

test('vents require ceiling support, fit over furniture and refuse structural or fitting clashes', () => {
  const vent = createModule('vent', 0, 0, 0, 'vent')
  assert.equal(equipmentReason([], [], vent), 'ceiling')
  assert.equal(equipmentReason([{ x: 0, y: 0, z: 4, fill: 'solid' }], [], vent), '')
  assert.equal(placementBlocked([createModule('desk', 0, 0, 0, 'desk')], vent), false)
  assert.equal(placementBlocked([createModule('pillar-slim', 0, 0, 0, 'pillar')], vent), true)
  assert.equal(placementBlocked([createModule('light-circular', 0, 0, 0, 'light')], vent), true)
  assert.equal(placementBlocked([vent], { ...vent, id: 'other' }), true)
})
