import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { parse, serialize } from '../src/persistence/save.ts'
import { createModule, toState } from '../src/build/model.ts'
import { addSuspendedCeiling } from '../src/build/model/Ceilings.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { moduleLevels } from '../src/render/scene/systems/SceneSystem.ts'
import { storeyBand } from '../src/sim/constants.ts'
import { rotateLocal } from '../src/sim/track.ts'
import { isGridModule } from '../src/build/model/Grid.ts'
import { moduleAim } from '../src/app/tools/moduleAim.ts'
import { useStore } from '../src/app/store.ts'
import { moduleEnvelope, moveCandidate, equipmentReason, pillarAt, liftAt, topBlockZ, wallMountStandCell } from '../src/sim/placement.ts'
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

test('suspended ceiling placement preserves existing fixture anchors across editing bases', () => {
  const lower = { ...createModule('light-circular', 0, 0, 18, 'lower'), ceilingAnchored: true }
  const upper = createModule('light-circular', 0, 0, 23, 'upper')
  for (const base of [0, 2, 4]) {
    const state = toState({ name: 'rooms', seed: 1, levelBase: base, cells: [solid(0, 0, 11), solid(0, 0, 19), solid(0, 0, 23), solid(0, 0, 32)], modules: [lower, upper], lines: [] })
    const result = addSuspendedCeiling(state, [[0, 0, 17], [0, 0, 28]])
    assert.equal(result.state.modules, state.modules)
    assert.deepEqual(result.state.modules.map(m => m.z), [18, 23])
  }
})


test('wall decor snaps to whole-metre cell edges through preview, commit, move and save', () => {
  const previous = useStore.getState()
  try {
    const cells = Array.from({ length: 11 }, (_, x) => Array.from({ length: 14 }, (_, i) => solid(40 + x, -24, i - 7))).flat()
    const originalCells = cells
    for (const rot of [0, 1, 2, 3]) {
    const cells = originalCells.map(c => { const [x, y] = rotateLocal(rot, c.x - 45, c.y + 23); return { ...c, x: 45 + x, y: -23 + y } })
      const [dx, dy] = rotateLocal(rot, 0, -1)
      const station = toState({ name: 'wall aim', seed: 1, cells, modules: [], lines: [] })
      for (const type of ['sign-wall', 'billboard-wide', 'calligraphy-kai-h', 'linemap-wall', 'glass-1x1', 'monitor-wall']) {
        for (const height of [-3.9, -3.1, -0.9, -0.1, 2.1, 2.9]) {
          useStore.setState({ station, moduleType: type, moduleRot: rot, past: [], future: [], signPreview: null })
          const tool = new EquipmentTool({})
          const hit = { cell: [45 + dx, -23 + dy, Math.floor(height)], place: [45, -23, Math.floor(height)], solid: true, point: [45.5 + dx * .5, -22.5 + dy * .5, height] }
          const snappedHeight = hit.cell[2]
          const preview = tool.wallMountPlacement(hit.cell, hit.place, 'preview', hit.point)
          assert.ok(preview, type)
          assert.equal(useStore.getState().station, station, 'hover never commits a document')
          if (snappedHeight !== 0) assert.equal(equipmentReason([], [], preview), 'wall', 'missing backing remains refused')
          const box = moduleEnvelope(preview)
          const inset = preview.type === 'sign' && box.z1 - box.z0 < 1 ? (1 - (box.z1 - box.z0)) / 2 : 0
          assert.ok(Math.abs(box.z0 - snappedHeight - inset) < 1e-8, type)
          if (preview.type === 'sign') assert.ok(Math.abs((box.z0 + box.z1) / 2 - (hit.cell[2] + .5)) < 1e-8, 'short wall sign has equal top and bottom margins within the cell')
          assert.equal(equipmentReason(cells, [], preview), '', type)
          tool.placeModule(hit.cell, hit.place, true, type, hit.point)
          const placed = useStore.getState().station.modules[0]
          assert.ok(placed, type)
          assert.equal(placed.z, preview.z, type)
          assert.deepEqual(moduleLevels(placed), [storeyBand((box.z0 + box.z1) / 2)], 'visibility follows the panel instead of its offset anchor')
          const saved = parse(serialize(toState({ ...station, modules: [placed] })))
          assert.equal(saved.state?.modules[0]?.z, placed.z, 'save round trip keeps exact wall height')
          const at = moduleAim(station, placed, { ...hit, point: [hit.point[0], hit.point[1], height + .17] })
          const moved = moveCandidate(cells, [], placed, { x: at[0], y: at[1], z: at[2] }, rot)
          assert.equal(moved.reason, '', type)
          assert.ok(Math.abs(moved.module.z - placed.z) < 1e-8, 'movement within the same wall cell keeps the same anchor')
          const nextCell = moduleAim(station, placed, { ...hit, cell: [45 + dx, -23 + dy, hit.cell[2] + 1], place: [45, -23, hit.cell[2] + 1] })
          assert.ok(Math.abs(nextCell[2] - at[2] - 1) < 1e-8, 'crossing a wall cell advances exactly one metre')
          const movedBox = moduleEnvelope(moved.module)
          assert.ok(Math.abs(movedBox.z0 - snappedHeight - inset) < 1e-8, type)
        }
      }
    }
  } finally { useStore.setState(previous) }
})


test('fractional height exemption belongs only to wall artwork', () => {
  for (const type of ['bench', 'sign-ceiling', 'linemap-stand', 'monitor-ceiling', 'curtain-wall']) {
    const mod = createModule(type, 0, 0, -.25, type)
    assert.ok(mod, type)
    assert.equal(isGridModule(mod), false, type)
  }
  for (const type of ['sign-wall', 'billboard-wide', 'glass-1x1']) {
    const mod = createModule(type, 0, 0, -.25, type)
    assert.equal(isGridModule(mod), true, type)
    assert.equal(isGridModule({ ...mod, z: Infinity }), false, type)
    assert.equal(isGridModule({ ...mod, x: .5 }), false, type)
  }
})
