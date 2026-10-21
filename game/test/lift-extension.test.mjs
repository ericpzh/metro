// Elevator extension snapping (电梯 层高) — GAME-SPEC §5.1.
//
// A lift is extended by hovering its upper or lower half, so the hover has to
// answer two questions before the car can grow: can the pointer reach the shaft's
// own surface, and is the shaft the piece the cell names? Two things used to stop
// it, and both are pinned here.
//
//   1. **Picking.** Every static surface of a lift is batched by
//      `EquipmentBatches`, which moves the retained picking meshes to
//      `BATCH_SOURCE_LAYER`. `CameraSystem.pick` intersects `liftPickMeshes` with
//      a layer-0 ray, so only the moving cabin and the door leaves answered:
//      aiming at the upper shaft (the half that extends it **up**) fell through to
//      the floor behind and no snap fired.
//   2. **Resolution.** `moduleAt` returns the first module whose envelope covers
//      the cell, and a canopy roof reserves the sheltered plan without occupying
//      the shaft. When the canopy is earlier in the document — the usual build
//      order — `moduleAt` answered the roof, so even a real hit on the shaft never
//      found the lift. `liftAt` asks the shaft's own 2 × 2 column first, and both
//      the hover and the release ask it.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { equipmentReason, liftAt, moduleAt } from '../src/sim/placement.ts'
import { liftExtendedDown, liftModule } from '../src/sim/lifts.ts'
import { buildModule, disposeObject } from '../src/render/models.ts'
import { EquipmentBatches } from '../src/render/equipmentBatches.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { cameraRig } from './support/camera-rig.mjs'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { useStore } from '../src/app/store.ts'

/* --------------------------------------------------------------- fixtures */

/** Open floor: a 10 × 12 slab at z = 0. */
function cells() {
  const out = []
  for (let x = 0; x < 10; x++) for (let y = 0; y < 12; y++) out.push({ x, y, z: 0, fill: 'solid' })
  return out
}

const state = (modules) => toState({ name: '电梯 snap', seed: 1, cells: cells(), modules, lines: [] })

/**
 * A 4 × 8 m canopy over the lift's column, and a three-metre lift at (1, 3)
 * standing in the sheltered aisle: the canopy's posts are on rows 1 and 6, so the
 * two pieces really do coexist (`equipmentReason` accepts the lift).
 */
function canopy() {
  return createModule('roof-canopy', 0, 0, 0, 'canopy', 0, 8)
}
const shortLift = () => liftModule({ x: 1, y: 3, z: 0 }, 0, 'lift-1', 3)

/* ------------------------------------------------------------ the lookup */

test('liftAt reads the shaft’s own 2 × 2 column, whatever covers it', () => {
  const roof = canopy()
  const lift = shortLift()
  for (const modules of [[roof, lift], [lift, roof]]) {
    assert.equal(liftAt(modules, 1, 3, 1)?.id, 'lift-1', 'front-left column')
    assert.equal(liftAt(modules, 2, 4, 1)?.id, 'lift-1', 'the far column of the 2 × 2 is the same shaft')
  }
  const roofFirst = [roof, lift]
  // The generic lookup is order-dependent: it answers the canopy here. That is
  // exactly what used to make the hover miss the lift.
  assert.equal(moduleAt(roofFirst, 1, 3, 1)?.id, 'canopy', 'the setup really does shadow a generic lookup')
  assert.equal(liftAt(roofFirst, 1, 3, 1)?.id, 'lift-1')
  assert.equal(liftAt(roofFirst, 5, 3, 1), undefined, 'outside the shaft column is no shaft')
  assert.equal(liftAt(roofFirst, 1, 3, 9), undefined, 'above the shaft is no shaft')
})

/* ------------------------------------------------------------ the tool */

function toolFixture() {
  const previews = []
  const highlights = []
  const scene = {
    setHoverHighlight() {},
    setModulePreview: (...args) => previews.push(args),
    setCollisionHighlight: (...args) => highlights.push(args),
    setCursor() {},
    setGhost() {},
    setFencePreview() {},
  }
  const ref = (current = null) => ({ current })
  const ctx = {
    scene: () => scene,
    pickModule: () => null,
    pick: () => null,
    facing: () => undefined,
    solids: () => new Set(),
    thins: () => new Map(),
    hover: ref(),
    drag: ref(),
    paint: ref(),
    zoneDrag: ref(),
    facilityDrag: ref(),
    showMeasure() {},
    clearMeasure() {},
  }
  return { previews, highlights, ctx }
}

const hoverAt = (x, y, z = 1) => ({
  clientX: 10,
  clientY: 10,
  button: 0,
  buttons: 0,
  shiftKey: false,
  hit: { cell: [x, y, z], place: [x, y, z], solid: true, point: [x + 0.5, y + 0.5] },
  preventDefault() {},
})

function armLift(modules) {
  useStore.setState({
    tool: 'module',
    moduleType: 'lift',
    liftInterval: 3,
    moduleRot: 0,
    station: state(modules),
    moveDraft: null,
    selected: null,
    notice: null,
  })
}

test('hovering a lift under a canopy grows that shaft down, not a second piece', () => {
  const before = useStore.getState()
  try {
    const roof = canopy()
    const lift = shortLift()
    armLift([roof, lift])
    const f = toolFixture()
    new EquipmentTool(f.ctx).onMove(hoverAt(1, 3))
    const [mods, blocked] = f.previews.at(-1)
    assert.equal(mods[0].id, 'lift-1', 'the ghost is the shaft under the pointer')
    assert.equal(mods[0].from.z, -3, 'the lower half extends one armed interval down')
    assert.equal(mods[0].to.z, 3)
    assert.equal(blocked, false, 'the canopy plate clears the grown shaft')
  } finally {
    useStore.setState(before)
  }
})

test('clicking the lift under a canopy commits the extension, in one piece', () => {
  const before = useStore.getState()
  try {
    const roof = canopy()
    const lift = shortLift()
    armLift([roof, lift])
    const f = toolFixture()
    const tool = new EquipmentTool(f.ctx)
    tool.onMove(hoverAt(1, 3))
    tool.onDown(hoverAt(1, 3))
    const station = useStore.getState().station
    assert.equal(station.modules.length, 2, 'the canopy and the one shaft')
    const grown = station.modules.find((m) => m.id === 'lift-1')
    assert.deepEqual([grown.from.z, grown.to.z], [-3, 3], 'the shaft grew down by the armed interval')
    assert.deepEqual(grown.cfg.rises, [3, 3])
  } finally {
    useStore.setState(before)
  }
})

/* ------------------------------------------------------------ the pick */

test('a batched lift still answers the pointer on its upper shaft', () => {
  const mats = new Proxy({}, { get: (o, k) => (o[k] ??= new THREE.MeshStandardMaterial()) })
  const mod = createModule('lift', 0, 0, 0, 'lift-pick')
  const data = { ...emptyStation(), cells: [], modules: [mod], lines: [] }
  const group = buildModule(mod, { data, mats, trackCells: new Set(), finish: () => mats.steel, owned: [] })
  group.userData = { ...group.userData, moduleId: mod.id, moduleType: 'lift', levelZs: [0] }
  const modules = new THREE.Group()
  modules.add(group)
  const batches = new EquipmentBatches()
  const { cam } = cameraRig()
  try {
    batches.sync(modules)
    const pickMeshes = []
    group.traverse((o) => { if (o.isMesh) pickMeshes.push(o) })
    // Batching really does move every static surface of the upper shaft to the
    // source layer; only the cabin and door leaves stay on layer 0.
    const p = new THREE.Vector3()
    let upper = 0
    let upperOnLayerZero = 0
    for (const mesh of pickMeshes) {
      mesh.getWorldPosition(p)
      if (p.z <= 4) continue
      upper++
      if (mesh.layers.isEnabled(0)) upperOnLayerZero++
    }
    assert.ok(upper > 0, 'the rig really has surfaces above the doors')
    assert.equal(upperOnLayerZero, 0, 'the upper shaft is retained only as a batch source')

    cam.setPickables(pickMeshes)
    // Straight at the front wall's upper panel, well above the doorway and the
    // cabin, so the only surface the ray can reach is the batched shaft itself.
    cam.camera.position.set(1, -9, 9)
    cam.camera.lookAt(1, 0, 4.6)
    cam.camera.updateMatrixWorld(true)
    const hit = cam.pick(640, 410, 0)
    assert.equal(hit?.solid, true, `the pointer reaches the upper shaft: ${JSON.stringify(hit)}`)
    assert.equal(hit.normal[2], 0, `it landed on a shaft face, not the work plane: ${JSON.stringify(hit)}`)
    assert.ok(hit.cell[2] >= 3 && hit.cell[2] <= 4, `hit cell ${hit.cell} (${JSON.stringify(hit)})`)
    assert.ok(hit.cell[0] >= 0 && hit.cell[0] <= 1 && hit.cell[1] >= 0 && hit.cell[1] <= 1, `hit cell ${hit.cell} (${JSON.stringify(hit)})`)
    assert.equal(cam.raycaster.layers.mask, 1, 'the source layer is restored for block picking')
  } finally {
    cam.dispose()
    batches.clear()
    disposeObject(group)
  }
})

test('the canopy fixture legally shares the lift column, and its extension is clear', () => {
  // Guard the fixtures themselves: the accepted lift really does stand under a
  // piece the generic lookup answers first, and its grown shaft is clear.
  const roof = canopy()
  const lift = shortLift()
  assert.equal(equipmentReason(cells(), [roof], lift, true), '', 'the lift can stand under the canopy')
  const grown = liftExtendedDown(lift, 3)
  assert.equal(equipmentReason(cells(), [roof, lift], grown, true), '', 'the extension is not refused')
})
