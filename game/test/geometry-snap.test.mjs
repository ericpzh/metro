import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { prepareSuspendedCeiling } from '../src/build/model/Ceilings.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { moduleAim } from '../src/app/tools/moduleAim.ts'
import { useStore } from '../src/app/store.ts'
import { moveCandidate, equipmentReason, pillarAt, liftAt, topBlockZ, wallMountStandCell } from '../src/sim/placement.ts'
import { hangerBoxes, hangerCells, hangerRoofZ } from '../src/sim/hangers.ts'
import { buildModule, disposeObject } from '../src/render/models.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const solid = (x, y, z) => ({ x, y, z, fill: 'solid' })
const props = ['cctv', 'cctv-ptz', 'cctv-dome', 'clock', 'tv', 'sign-ceiling', 'monitor-ceiling', 'light-circular', 'light-rectangular', 'vent']

test('ceiling props: actual slabs drive preview, render, commit, move and undo independently of editing base', () => {
  const previous = useStore.getState(), document = globalThis.document
  globalThis.document = { createElement() { const node = { width: 512, height: 256 }, { g } = stubCanvas(); g.canvas = node; node.getContext = () => g; return node } }
  const material = new THREE.MeshStandardMaterial()
  try {
    for (const floor of [1, 6, 11, 17]) for (const span of [3, 7, 12]) for (const base of [0, 2, 4]) for (const type of props) {
      const ceiling = floor + span
      const station = { name: 'actual surfaces', seed: 1, levelBase: base, storeyHeight: 5, cells: [solid(0, 0, floor), solid(0, 0, ceiling)], modules: [], lines: [] }
      useStore.setState({ station: toState(station), moduleType: type, moduleRot: 0, past: [], future: [], moveDraft: null })
      const tool = new EquipmentTool({})
      const hit = { cell: [0, 0, floor], place: [0, 0, floor + 1], solid: true }
      const anchor = moduleAim(station, type, hit)
      assert.deepEqual(anchor, [0, 0, ceiling - 1], `${type}, floor ${floor}, span ${span}, base ${base}`)
      const preview = tool.ceilingPlacement(hit.cell, hit.place, 'preview')[0]
      assert.equal(preview.ceilingAnchored, true)
      assert.equal(equipmentReason(station.cells, [], preview), '')
      const textures = []
      const rendered = buildModule(preview, { data: station, mats: new Proxy({}, { get: () => material }), owned: [],
        tvPlate: () => { const texture = new THREE.CanvasTexture(globalThis.document.createElement('canvas')); textures.push(texture); return texture },
        ads: { adWindow: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material }), adFace: () => ({ geometry: new THREE.PlaneGeometry(1, 1), material }) },
      })
      const bounds = new THREE.Box3().setFromObject(rendered)
      assert.ok(bounds.max.z <= ceiling + 1e-5, `${type} cannot pierce its support`)
      assert.ok(bounds.max.z > ceiling - 0.1, `${type} reaches the actual ceiling`)
      disposeObject(rendered)
      for (const texture of textures) texture.dispose()
      tool.placeModule(hit.cell, hit.place, true, type)
      const placed = useStore.getState().station.modules[0]
      assert.ok(placed)
      assert.equal(placed.z, preview.z)
      assert.equal(placed.ceilingAnchored, true)
      const carried = { ...placed, z: -30, ceilingAnchored: false }
      assert.deepEqual(moduleAim(station, carried, hit), anchor)
      const moved = moveCandidate(station.cells, [], carried, { x: 0, y: 0, z: anchor[2] }, 0)
      assert.equal(moved.reason, '')
      assert.equal(moved.module.ceilingAnchored, true)
      useStore.getState().undo()
      assert.equal(useStore.getState().station.modules.length, 0)
    }
  } finally { useStore.setState(previous); material.dispose(); if (document === undefined) delete globalThis.document; else globalThis.document = document }
})

test('wall and missing-ceiling aims use real columns and floors across grid boundaries', () => {
  for (const floor of [-7, 1, 6, 11, 17]) for (const base of [0, 2, 4]) {
    const cells = [solid(0, 0, floor), ...Array.from({ length: 7 }, (_, i) => ({ ...solid(0, 1, floor + i + 1), tags: ['wall'] }))]
    if (floor < 0) cells.push({ x: 0, y: 0, z: 0, fill: 'void' })
    const station = { cells, modules: [], levelBase: base, storeyHeight: 5 }
    const hit = { cell: [0, 1, floor + 6], place: [0, 0, floor + 6], solid: true }
    for (const type of ['billboard-wide', 'linemap-wall', 'calligraphy-kai-h', 'sign-wall', 'monitor-wall']) {
      assert.deepEqual(moduleAim(station, type, hit), [0, 0, floor])
      const carried = createModule(type, 20, 20, 0, 'carried')
      assert.deepEqual(moduleAim(station, carried, hit), [0, 0, floor])
    }
    assert.deepEqual(moduleAim(station, 'glass-1x1', hit), [0, 0, floor + 5])
    assert.deepEqual(moduleAim(station, 'clock', { cell: [0, 0, floor], place: [0, 0, floor + 1], solid: true }), [0, 0, floor])
    assert.deepEqual(wallMountStandCell(cells.filter(c => c.y === 1), hit.cell, hit.place, false, base), [0, 0, floor], 'the bottom of a wall is usable without an adjacent floor')
  }
})

test('hanger backing and extension targets follow physical heights across storey boundaries', () => {
  const hanger = createModule('hanger-roof', 0, 0, 11, 'hanger', 0, 4)
  for (const z of [16, 18, 23]) {
    const cells = hangerCells(hanger).map(([x, y]) => solid(x, y, z))
    assert.equal(hangerRoofZ(cells, [], hanger, 0, 0), z)
  }
  const cells = hangerCells(hanger).flatMap(([x, y]) => [solid(x, y, 11), solid(x, y, 18)])
  const slabMounted = { ...createModule('cctv-ptz', 20, 20, 17, 'carried'), ceilingAnchored: true }
  const moved = moveCandidate(cells, [hanger], slabMounted, { x: 1, y: 0, z: 11 }, 0)
  assert.equal(moved.reason, '')
  assert.equal(moved.module.ceilingAnchored, undefined, 'a slab flag cannot survive a drop onto a beam')
  const material = new THREE.MeshStandardMaterial()
  const model = buildModule(moved.module, { data: { cells, modules: [hanger], lines: [] }, mats: new Proxy({}, { get: () => material }), owned: [] })
  assert.ok(Math.abs(new THREE.Box3().setFromObject(model).max.z - hangerBoxes(hanger)[0].z1) < 1e-5, 'the camera mount actually meets the beam')
  disposeObject(model); material.dispose()
  const pillar = createModule('pillar-slim', 0, 0, 11, 'pillar'); pillar.cfg.height = 10
  const lift = createModule('lift', 3, 0, 11, 'lift')
  for (const base of [0, 2, 4]) {
    assert.equal(pillarAt([pillar], 0, 0, 14, base)?.id, pillar.id, 'last course of a nominal storey still hits the real shaft')
    assert.equal(pillarAt([pillar], 0, 0, 9, base), undefined)
    assert.equal(liftAt([lift], 3, 0, 14, base)?.id, lift.id)
    assert.equal(liftAt([lift], 3, 0, 9, base), undefined)
  }
  assert.equal(topBlockZ([], 20, 20, -8), 0, 'the actual street is a ceiling regardless of room height')
})

test('suspended ceilings reattach within the real room, including already ceiling-anchored fixtures', () => {
  const lower = { ...createModule('light-circular', 0, 0, 18, 'lower'), ceilingAnchored: true }
  const upper = createModule('light-circular', 0, 0, 23, 'upper')
  for (const base of [0, 2, 4]) {
    const state = toState({ name: 'rooms', seed: 1, levelBase: base, cells: [solid(0, 0, 11), solid(0, 0, 19), solid(0, 0, 23), solid(0, 0, 32)], modules: [lower, upper], lines: [] })
    const prepared = prepareSuspendedCeiling(state, [[0, 0, 17], [0, 0, 28]])
    assert.deepEqual(prepared.modules.map(m => m.z), [16, 27])
    assert.ok(prepared.modules.every(m => m.ceilingAnchored))
  }
})
