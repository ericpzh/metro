import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { canonicalUntexturedMaterialKey } from '../src/render/materialCanonical.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { ExplodedLayout } from '../src/render/explodedLayout.ts'
import { PlateSystem } from '../src/render/scene/systems/PlateSystem.ts'
import { ModuleSystem } from '../src/render/scene/systems/ModuleSystem.ts'
import { LiftSystem } from '../src/render/scene/systems/LiftSystem.ts'
import { rollEscalator } from '../src/render/models/pieces/EscalatorModel.ts'
import { omitModelDetail } from '../src/render/modelDetail.ts'
import { SourceGeometryDetail } from '../src/render/sourceGeometryDetail.ts'
import { ESCALATOR_SPEED } from '../src/sim/constants.ts'
import { World } from '../src/sim/world.ts'
import { REFERENCE_BOOT } from '../src/data/reference-station.ts'
import { readFileSync } from 'node:fs'

test('canonicalUntexturedMaterialKey merges identical untextured static materials and keeps textured or distinct ones separate', () => {
  const planeIds = new WeakMap()
  let nextId = 0
  const next = () => ++nextId
  const a = new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.43 })
  const b = new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.43 })
  const diffColor = new THREE.MeshStandardMaterial({ color: 0x175586, metalness: 0.7, roughness: 0.43 })
  const diffRough = new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.5 })
  const textured = new THREE.MeshStandardMaterial({ color: 0x175585, map: new THREE.DataTexture(new Uint8Array(4), 1, 1) })
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  const clipped = new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.43 })
  clipped.clippingPlanes = [plane]

  const ka = canonicalUntexturedMaterialKey(a, true, planeIds, next)
  const kb = canonicalUntexturedMaterialKey(b, true, planeIds, next)
  assert.ok(ka && ka.startsWith('canon:'))
  assert.equal(ka, kb)
  assert.notEqual(ka, canonicalUntexturedMaterialKey(diffColor, true, planeIds, next))
  assert.notEqual(ka, canonicalUntexturedMaterialKey(diffRough, true, planeIds, next))
  assert.equal(canonicalUntexturedMaterialKey(textured, true, planeIds, next), null)
  assert.notEqual(ka, canonicalUntexturedMaterialKey(clipped, true, planeIds, next))
  assert.equal(ka, canonicalUntexturedMaterialKey(clipped, false, planeIds, next))
  const translucent = new THREE.MeshStandardMaterial({ color: 0x175585, transparent: true, opacity: 0.5 })
  assert.equal(canonicalUntexturedMaterialKey(translucent, false), null, 'transparent materials are excluded from canonicalization')

  a.dispose(); b.dispose(); diffColor.dispose(); diffRough.dispose(); textured.map?.dispose(); textured.dispose(); clipped.dispose(); translucent.dispose()
})

test('EquipmentBatches merges per-module untextured owned materials into one batch draw', () => {
  const modules = new THREE.Group()
  const owned = []
  for (let i = 0; i < 4; i++) {
    const root = new THREE.Group()
    root.userData = { moduleId: `fence-${i}`, moduleType: 'fence', levelZs: [0] }
    const mat = new THREE.MeshStandardMaterial({ color: 0x175585, metalness: 0.7, roughness: 0.43 })
    owned.push(mat)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), mat)
    mesh.position.set(i * 2, 0, 0.5)
    root.add(mesh)
    modules.add(root)
  }
  const batches = new EquipmentBatches()
  batches.graphicsQuality = 'low'
  batches.sync(modules, 'v1', 'g1', 'view')
  assert.equal(batches.root.children.length, 1, 'four separately-minted identical fence materials merge into one batch')
  batches.clear()
  for (const m of owned) m.dispose()
  modules.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose() })
})

test('ExplodedLayout merges identical instanced geometries across deferred streaming stages and flushes incrementally', () => {
  const layout = new ExplodedLayout([-10])
  const mats = []
  const geos = []
  const sources = []
  for (let stage = 0; stage < 3; stage++) {
    const group = new THREE.Group()
    group.userData.levelZ = -10
    const mat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.4 })
    const geo = new THREE.BoxGeometry(1, 1, 1)
    mats.push(mat); geos.push(geo)
    const inst = new THREE.InstancedMesh(geo, mat, 2)
    inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(stage * 4, 0, -9))
    inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(stage * 4 + 2, 0, -9))
    group.add(inst)
    sources.push(group)
    layout.generate([group], [], 0, undefined, true)
  }
  assert.equal(layout.hasPending(), true)
  assert.equal(layout.floors[0].children.length, 0)
  while (!layout.flushPendingStep(100)) { /* drain */ }
  assert.equal(layout.hasPending(), false)
  assert.equal(layout.floors[0].children.length, 1, 'identical content InstancedMeshes across stages consolidate into one draw')
  const merged = layout.floors[0].children[0]
  assert.ok(merged instanceof THREE.InstancedMesh)
  assert.equal(merged.count, 6)
  assert.equal(merged.matrixAutoUpdate, false)
  layout.dispose()
  for (const g of geos) g.dispose()
  for (const m of mats) m.dispose()
})

test('PlateSystem budgeted TV repaints coalesce latest state and prioritize visible panels', () => {
  const mkCanvas = () => ({ width: 960, height: 540, getContext: () => ({ clearRect() {}, fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {}, measureText: () => ({ width: 20 }) }) })
  const data = {
    name: 'Test',
    cells: [],
    lines: [{ id: '1', name: 'L1', colour: '#ff0000', direction: 'up', upTerminus: 'A', downTerminus: 'B', headwayProfile: { peak: 180, offpeak: 300, late: 480 }, travelSign: 1 }],
    modules: [
      { id: 'tv-hidden', type: 'tv', x: 0, y: 0, z: -10, cfg: {} },
      { id: 'tv-visible', type: 'tv', x: 2, y: 0, z: -5, cfg: {} },
    ],
  }
  const plates = new PlateSystem({ stationData: data })
  plates.budgetedTvRepaint = true
  const texHidden = new THREE.CanvasTexture(mkCanvas())
  const texVisible = new THREE.CanvasTexture(mkCanvas())
  plates.tvPlates.set('tv-hidden', texHidden)
  plates.tvPlates.set('tv-visible', texVisible)
  const vHidden0 = texHidden.version
  const vVisible0 = texVisible.version

  plates.setSimClock(23400, [])
  plates.setSimClock(23460, []) // coalesces before flush
  assert.equal(texHidden.version, vHidden0)
  assert.equal(texVisible.version, vVisible0)
  assert.equal(plates.hasPendingTvPlates, true)

  const painted1 = plates.flushTvPlates(1, id => id === 'tv-visible')
  assert.equal(painted1, 1)
  assert.equal(texVisible.version, vVisible0 + 1, 'visible TV repaints first')
  assert.equal(texHidden.version, vHidden0, 'hidden TV waits for next frame budget')

  const painted2 = plates.flushTvPlates(1, id => id === 'tv-visible')
  assert.equal(painted2, 1)
  assert.equal(texHidden.version, vHidden0 + 1)
  assert.equal(plates.hasPendingTvPlates, false)

  texHidden.dispose()
  texVisible.dispose()
})

test('rollEscalator skips omitted zero-vertex parts while writing valid matrices to drawable treads', () => {
  const tread = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 1), new THREE.MeshBasicMaterial(), 4)
  const omittedNose = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 4)
  const omittedRisers = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 4)
  const noseVersionBefore = omittedNose.instanceMatrix.version
  const riserVersionBefore = omittedRisers.instanceMatrix.version
  const roll = {
    parts: [tread, omittedNose],
    count: 4,
    climb: new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
    runLen: 4,
    pitch: 1,
    dir: 1,
    phase: 0,
    yaw: 0,
    risers: omittedRisers,
    inclineLen: 2,
    flat: 1,
    stepRun: 0.7,
    stepRise: 0.7,
  }
  rollEscalator(roll, 1)
  assert.equal(omittedNose.instanceMatrix.version, noseVersionBefore, 'omitted nosing skips upload')
  assert.equal(omittedRisers.instanceMatrix.version, riserVersionBefore, 'omitted risers skip upload')
  assert.equal(tread.instanceMatrix.array[15], 1)
  tread.geometry.dispose(); tread.material.dispose(); tread.dispose()
  omittedNose.geometry.dispose(); omittedNose.material.dispose(); omittedNose.dispose()
  omittedRisers.geometry.dispose(); omittedRisers.material.dispose(); omittedRisers.dispose()
})

test('stamped collision and congestion grids preserve exact replay across restart and rebuild', () => {
  const data = JSON.parse(readFileSync(new URL('../src/data/demo-station.json', import.meta.url), 'utf8'))
  const w1 = new World(data, data.seed)
  const w2 = new World(data, data.seed)
  w1.simTime = REFERENCE_BOOT.startSeconds
  w2.simTime = REFERENCE_BOOT.startSeconds
  for (let i = 0; i < 120; i++) {
    w1.tickOnce()
    w2.tickOnce()
  }
  const b1 = new Float32Array(w1.pool.count * 6)
  const b2 = new Float32Array(w2.pool.count * 6)
  assert.equal(w1.writeTransfer(b1), w2.writeTransfer(b2))
  assert.deepEqual(Array.from(b1), Array.from(b2))
  w1.restart()
  w2.restart()
  for (let i = 0; i < 60; i++) {
    w1.tickOnce()
    w2.tickOnce()
  }
  const r1 = new Float32Array(w1.pool.count * 6)
  const r2 = new Float32Array(w2.pool.count * 6)
  assert.equal(w1.writeTransfer(r1), w2.writeTransfer(r2))
  assert.deepEqual(Array.from(r1), Array.from(r2))
})

test('LiftSystem refreshes hidden and Low-omitted escalator parts on paused reveal or Low-to-High switch and resumes from accumulated phase', () => {
  const parent = new THREE.Group()
  const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 0.06), new THREE.MeshBasicMaterial(), 4)
  const nose = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1, 0.08), new THREE.MeshBasicMaterial(), 4)
  const risers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.3), new THREE.MeshBasicMaterial(), 4)
  omitModelDetail(nose)
  omitModelDetail(risers)
  parent.add(tread, nose, risers)

  const roll = {
    parts: [tread, nose],
    count: 4,
    climb: new THREE.Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
    runLen: 4,
    pitch: 1,
    dir: 1,
    phase: 0,
    yaw: 0,
    risers,
    inclineLen: 2,
    flat: 1,
    stepRun: 0.7,
    stepRise: 0.7,
  }
  rollEscalator(roll, 0)

  const lifts = new LiftSystem({})
  lifts.escalatorRolls.push(roll)
  const sourceDetail = new SourceGeometryDetail(true)

  try {
    // 1) Hide during playback: phase accumulates while skipping matrix writes.
    parent.visible = false
    const treadV0 = tread.instanceMatrix.version
    const noseV0 = nose.instanceMatrix.version
    const risersV0 = risers.instanceMatrix.version
    lifts.setPlaying(true)
    lifts.updateEscalators(1.5)
    const phaseAfterHidden = roll.phase
    assert.ok(Math.abs(phaseAfterHidden - ESCALATOR_SPEED * 1.5) < 1e-6)
    assert.equal(tread.instanceMatrix.version, treadV0, 'hidden escalator skips tread writes')
    assert.equal(nose.instanceMatrix.version, noseV0, 'hidden escalator skips nose writes')
    assert.equal(risers.instanceMatrix.version, risersV0, 'hidden escalator skips riser writes')

    // 2) Pause and reveal: newly visible parts sync to the accumulated phase before draw without advancing phase.
    lifts.setPlaying(false)
    parent.visible = true
    lifts.updateEscalators(0.5)
    assert.equal(roll.phase, phaseAfterHidden, 'paused reveal does not advance phase')
    assert.equal(tread.instanceMatrix.version, treadV0 + 1)
    assert.equal(nose.instanceMatrix.version, noseV0 + 1)
    assert.equal(risers.instanceMatrix.version, risersV0 + 1)
    assert.deepEqual(Array.from(nose.instanceMatrix.array), Array.from(tread.instanceMatrix.array), 'revealed nose matches tread phase')

    // Second paused frame skips redundant writes.
    lifts.updateEscalators(0.5)
    assert.equal(tread.instanceMatrix.version, treadV0 + 1)

    // 3) Switch to Low detail during playback: treads advance while omitted nosings and risers skip writes.
    sourceDetail.apply(parent, true)
    const noseLowV = nose.instanceMatrix.version
    const risersLowV = risers.instanceMatrix.version
    lifts.setPlaying(true)
    lifts.updateEscalators(1.0)
    const phaseAfterLow = roll.phase
    assert.ok(Math.abs(phaseAfterLow - ((phaseAfterHidden + ESCALATOR_SPEED) % 4)) < 1e-6)
    assert.equal(nose.instanceMatrix.version, noseLowV, 'Low detail omits nose writes')
    assert.equal(risers.instanceMatrix.version, risersLowV, 'Low detail omits riser writes')

    // 4) Pause and switch Low -> High: reappearing nosings and risers sync to treads at exact phase.
    lifts.setPlaying(false)
    sourceDetail.restore()
    const treadHighV = tread.instanceMatrix.version
    lifts.updateEscalators(0.25)
    assert.equal(roll.phase, phaseAfterLow, 'paused Low->High keeps phase unchanged')
    assert.equal(tread.instanceMatrix.version, treadHighV, 'already-synced treads skip redundant write')
    assert.equal(nose.instanceMatrix.version, noseLowV + 1, 'reappearing nose syncs to tread phase')
    assert.equal(risers.instanceMatrix.version, risersLowV + 1, 'reappearing risers sync to tread phase')
    assert.deepEqual(Array.from(nose.instanceMatrix.array), Array.from(tread.instanceMatrix.array), 'nose matches treads after paused Low->High')
    // Riser positions (m[12..14]) match tread positions for every step.
    for (let i = 0; i < roll.count; i++) {
      const off = i * 16
      assert.equal(risers.instanceMatrix.array[off + 12], tread.instanceMatrix.array[off + 12])
      assert.equal(risers.instanceMatrix.array[off + 13], tread.instanceMatrix.array[off + 13])
      assert.equal(risers.instanceMatrix.array[off + 14], tread.instanceMatrix.array[off + 14])
    }

    // 5) First resumed frame advances from the exact accumulated phase.
    lifts.setPlaying(true)
    lifts.updateEscalators(0.5)
    assert.ok(Math.abs(roll.phase - ((phaseAfterLow + ESCALATOR_SPEED * 0.5) % 4)) < 1e-6)
  } finally {
    sourceDetail.restore()
    for (const m of [tread, nose, risers]) { m.geometry.dispose(); m.material.dispose(); m.dispose() }
  }
})

test('TV visibility lookup stays O(1) across station size growth, tracks live reveal/move/undo state, and prioritizes revealed TV with latest content', () => {
  const drawLogs = []
  const mkCanvas = (id) => {
    let lastText = ''
    const g = {
      clearRect() {}, fillRect() {}, beginPath() {}, roundRect() {}, fill() {},
      fillText(text) { if (/^\d\d:\d\d$/.test(String(text))) lastText = String(text) },
      measureText: () => ({ width: 20 }),
      get lastClock() { return lastText },
    }
    const canvas = { width: 960, height: 540, getContext: () => g, _logId: id }
    return { canvas, g }
  }

  const runWithUnrelatedRoots = (unrelatedCount) => {
    const scene = new THREE.Scene()
    const modules = new ModuleSystem({ scene })
    const tvModules = []
    const tvRoots = new Map()
    const tvG = new Map()
    for (let i = 0; i < 6; i++) {
      const id = `tv-${i}`
      tvModules.push({ id, type: 'tv', x: i * 2, y: 0, z: -5, cfg: {} })
      const root = new THREE.Group()
      root.userData = { moduleId: id, moduleType: 'tv', levelZs: [-5] }
      root.visible = false
      modules.moduleMeshes.add(root)
      tvRoots.set(id, root)
    }
    for (let i = 0; i < unrelatedCount; i++) {
      const root = new THREE.Group()
      root.userData = { moduleId: `bench-${i}`, moduleType: 'bench', levelZs: [-5] }
      modules.moduleMeshes.add(root)
    }
    const data = {
      name: 'WorkCount',
      cells: [],
      lines: [{ id: '1', name: 'L1', colour: '#ff0000', direction: 'up', upTerminus: 'A', downTerminus: 'B', headwayProfile: { peak: 180, offpeak: 300, late: 480 }, travelSign: 1 }],
      modules: tvModules,
    }
    const plates = new PlateSystem({ stationData: data })
    plates.budgetedTvRepaint = true
    const textures = []
    for (const m of tvModules) {
      const { canvas, g } = mkCanvas(m.id)
      const tex = new THREE.CanvasTexture(canvas)
      plates.tvPlates.set(m.id, tex)
      tvG.set(m.id, { tex, g })
      textures.push(tex)
    }

    // Spy on moduleMeshes.children reads to count root scans deterministically.
    const realChildren = modules.moduleMeshes.children
    let childrenReads = 0
    Object.defineProperty(modules.moduleMeshes, 'children', {
      configurable: true,
      get() { childrenReads++; return realChildren },
    })

    // Queue multiple updates while all TVs are hidden (coalescing to latest clock 06:32).
    plates.setSimClock(6 * 3600 + 30 * 60, [])
    plates.setSimClock(6 * 3600 + 32 * 60, [])
    childrenReads = 0
    // Reveal the last TV in the queue; flush with budget 1.
    tvRoots.get('tv-5').visible = true
    const painted1 = plates.flushTvPlates(1, id => modules.isModuleVisible(id))
    const scans1 = childrenReads
    assert.equal(painted1, 1, 'respects 1-panel repaint budget')
    assert.equal(tvG.get('tv-5').g.lastClock, '06:32', 'revealed TV is prioritized and draws latest queued content')
    assert.equal(tvG.get('tv-0').g.lastClock, '', 'hidden TV waits')

    // Hide parent ancestor -> live ancestor visibility reports false.
    modules.moduleMeshes.visible = false
    assert.equal(modules.isModuleVisible('tv-5'), false)
    modules.moduleMeshes.visible = true
    assert.equal(modules.isModuleVisible('tv-5'), true)

    // Remove and re-add (undo/redo replacement) updates index to live root.
    const oldRoot = tvRoots.get('tv-4')
    modules.moduleMeshes.remove(oldRoot)
    assert.equal(modules.isModuleVisible('tv-4'), false)
    const replacementRoot = new THREE.Group()
    replacementRoot.userData = { moduleId: 'tv-4', moduleType: 'tv', levelZs: [-5] }
    replacementRoot.visible = true
    modules.moduleMeshes.add(replacementRoot)
    childrenReads = 0
    assert.equal(modules.isModuleVisible('tv-4'), true, 're-added root uses live visibility')
    const painted2 = plates.flushTvPlates(1, id => modules.isModuleVisible(id))
    assert.equal(painted2, 1)
    assert.equal(tvG.get('tv-4').g.lastClock, '06:32')
    const scans2 = childrenReads

    Object.defineProperty(modules.moduleMeshes, 'children', { configurable: true, value: realChildren, writable: true })
    for (const tex of textures) tex.dispose()
    modules.batches.clear()
    return { scans1, scans2 }
  }

  const small = runWithUnrelatedRoots(10)
  const large = runWithUnrelatedRoots(500)
  assert.equal(small.scans1, 0, 'repaint selection performs zero root array scans')
  assert.equal(large.scans1, 0, 'growing station size adds zero root scans')
  assert.equal(large.scans2, 0)
  void drawLogs
})
