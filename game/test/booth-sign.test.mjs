import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { WALL_SIGN_STAND_OFF, snapSignToBooth, boothSupportsSign } from '../src/sim/boothSigns.ts'
import { equipmentReason, moduleEnvelope, moveCandidate, autofaceWallMount, placementColliders, wallMountMissing } from '../src/sim/placement.ts'
import { createModule, toState } from '../src/build/model.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { buildModule } from '../src/render/models.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { boothSignHit } from '../src/app/tools/boothSignHit.ts'
import { signModuleWithPreview, useStore } from '../src/app/store.ts'
import { cameraRig } from './support/camera-rig.mjs'

const booth = (kind, w = 4, h = 3, z = 0) => ({ id: 'counter', type: 'booth', x: 7, y: -5, z, w, h, cfg: { kind } })
const wallSign = () => createModule('sign-wall', 0, 0, 0, 'sign', 0)
const points = (b) => [
  [b.x + b.w / 2, b.y], [b.x + b.w / 2, b.y + b.h],
  [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2],
]
function drawnBounds(sign) {
  const mats = new Proxy({}, { get: (t, key) => t[key] ??= new THREE.MeshStandardMaterial({ name: String(key) }) })
  const group = buildModule(sign, { mats, data: { name: 'test', cells: [], modules: [sign], lines: [] },
    trackCells: new Set(), finish: () => mats.steel, owned: [] })
  group.updateMatrixWorld(true)
  return { group, box: new THREE.Box3().setFromObject(group) }
}

test('wall signs centre on every booth face and align their top with the header', () => {
  for (const kind of ['info', 'ticket']) for (const [w, h] of [[3, 3], [4, 4], [5, 6]]) for (const z of [0, -4]) {
    const b = booth(kind, w, h, z)
    for (const point of points(b)) {
      const sign = snapSignToBooth([b], wallSign(), point, z + 2)
      assert.ok(boothSupportsSign(b, sign))
      assert.equal(equipmentReason([], [b], sign), '', 'the header backs the sign without a wall or ceiling slab')
      assert.ok([sign.x, sign.y, sign.z].every(Number.isInteger), 'saving keeps grid anchors')
      const { group, box } = drawnBounds(sign)
      assert.ok(Math.abs(box.max.z - (z + 1 + 2.4)) < 1e-6, 'top edge is flush with header top')
      assert.ok(Math.abs(box.min.z - (z + 1 + 2.0)) < 1e-6, 'board sits on header rather than at eye height')
      const centre = box.getCenter(new THREE.Vector3())
      assert.ok(Math.abs((sign.rot % 2 ? centre.y : centre.x)
        - (sign.rot % 2 ? b.y + b.h / 2 : b.x + b.w / 2)) < 1e-6, 'even and odd booths both centre the board')
      const e = moduleEnvelope(sign)
      for (const axis of ['x', 'y', 'z']) {
        const normal = axis === (sign.rot % 2 ? 'x' : 'y')
        const tolerance = normal ? WALL_SIGN_STAND_OFF + 1e-6 : 1e-6
        assert.ok(Math.abs(box.min[axis] - e[`${axis}0`]) < tolerance, `${axis}: sheet is inside collision bounds`)
        assert.ok(Math.abs(box.max[axis] - e[`${axis}1`]) < tolerance, `${axis}: sheet is inside collision bounds`)
        if (normal) {
          assert.ok(box.max[axis] - box.min[axis] < 1e-6, 'the rendered sign is a sheet without a back block')
          assert.ok(Math.abs(e[`${axis}1`] - e[`${axis}0`] - 0.003) < 1e-6, 'only 3 mm of stand-off is reserved')
        }
      }
      assert.equal(group.children.length, 1, 'only the printed sign sheet attaches to the header')
      assert.equal(equipmentReason([], [b, { ...sign, id: 'duplicate' }], sign), 'occupied', 'a second sign cannot occupy the same header')
    }
  }
})

test('booth attachment persists through saves and fails if its backing disappears', () => {
  const b = booth('ticket')
  const sign = snapSignToBooth([b], wallSign(), points(b)[0], b.z)
  const state = toState({ name: 'test', cells: [], modules: [b, sign], lines: [] })
  const loaded = parse(serialize(state))
  assert.ok(loaded.ok)
  assert.equal(loaded.droppedModules, 0)
  const restored = loaded.state.modules.find((m) => m.id === sign.id)
  assert.deepEqual(restored.cfg, sign.cfg)
  assert.equal(equipmentReason([], [b], restored), '')
  assert.equal(equipmentReason([], [], restored), 'wall')
  assert.notEqual(moduleGhostKey(sign), moduleGhostKey({ ...sign, cfg: { ...sign.cfg, boothId: undefined } }), 'ghost refreshes when the mount height changes')
})

test('moving a wall sign onto a booth snaps it; moving back to a normal wall clears the attachment', () => {
  const b = booth('info')
  const sign = wallSign()
  const snapped = moveCandidate([], [b], sign, { x: 8, y: -5, z: 0 }, 0, points(b)[0])
  assert.equal(snapped.reason, '')
  assert.ok(boothSupportsSign(b, snapped.module))
  const wall = [{ x: 20, y: 19, z: 2, fill: 'solid' }]
  const free = moveCandidate(wall, [b], snapped.module, { x: 20, y: 20, z: 0 }, 0, [20.5, 20])
  assert.equal(free.reason, '')
  assert.equal(free.module.cfg.boothId, undefined)
  assert.equal(free.module.cfg.boothOffset, undefined)
  assert.ok(Math.abs(moduleEnvelope(free.module).z1 - 2.85) < 1e-6, 'normal walls keep eye-height signs')
})

test('booth snap leaves other mounts and other storeys alone', () => {
  const b = booth('ticket')
  const sign = wallSign()
  assert.equal(snapSignToBooth([b], sign, points(b)[0], 4).cfg.boothId, undefined)
  const hung = createModule('sign-ceiling', 0, 0, 0, 'hung')
  assert.deepEqual(snapSignToBooth([b], hung, points(b)[0], 0), hung)
})

test('ordinary sticking signs reserve only their 3 mm printed sheet at every rotation', () => {
  for (let rot = 0; rot < 4; rot++) {
    const sign = { ...wallSign(), rot }
    const box = moduleEnvelope(sign)
    const depth = rot % 2 ? box.x1 - box.x0 : box.y1 - box.y0
    assert.ok(Math.abs(depth - 0.003) < 1e-9, `rotation ${rot} reserves a sheet, not a 25 cm back box`)
  }
})

test('booth face ties use the documented stable rotation order, and non-booth hits fall back', () => {
  const b = booth('ticket', 4, 4)
  const tied = snapSignToBooth([b], wallSign(), [b.x, b.y], b.z + 2)
  assert.equal(tied.rot, 2, 'a corner tie chooses the first north/south face')
  const fallback = { cell: [9, 8, 0], place: [9, 8, 0], solid: true, normal: [0, 0, 1], point: [9, 8, 1] }
  const scene = { pickModuleHit: () => ({ moduleId: 'not-a-booth', point: [2, 3, 4] }) }
  assert.equal(boothSignHit(scene, [{ ...b, id: 'other' }], 0, 0, fallback), fallback)
})

test('the header refuses boards wider than its face, shifted anchors and wrong mounts', () => {
  const b = booth('ticket', 2, 2, 0)
  const wide = {
    ...wallSign(),
    cfg: {
      ...wallSign().cfg,
      front: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, kind: 'arrow', arrow: 'right', x: 0, y: 0.35, scale: 1, side: 'both' })),
    },
  }
  const snapped = snapSignToBooth([b], wide, [b.x + b.w / 2, b.y], b.z)
  assert.equal(snapped.cfg.boothId, b.id, 'snapping centres first and measures later')
  assert.equal(boothSupportsSign(b, snapped), false, 'a 3.48 m board overhangs a 2 m header')
  assert.notEqual(equipmentReason([], [b], snapped), '', 'an overhanging board keeps no backing')
  const good = snapSignToBooth([booth('ticket')], wallSign(), points(booth('ticket'))[0], 0)
  const shifted = { ...good, x: good.x + 1 }
  assert.equal(boothSupportsSign(booth('ticket'), shifted), false, 'a board off its anchor hangs on nothing')
  const badOffset = { ...good, cfg: { ...good.cfg, boothOffset: { x: 99, y: 0 } } }
  assert.equal(boothSupportsSign(booth('ticket'), badOffset), false, 'a forged offset is not the header')
  const ceiling = { ...good, cfg: { ...good.cfg, mount: 'ceiling' } }
  assert.equal(boothSupportsSign(booth('ticket'), ceiling), false, 'a hung board is never booth-backed')
  assert.equal(boothSupportsSign({ ...booth('ticket'), type: 'wall' }, good), false, 'only a booth backs a booth sign')
  assert.equal(snapSignToBooth([{ ...b, type: 'wall' }], wallSign(), [b.x + b.w / 2, b.y], b.z).cfg.boothId, undefined)
})

test('an attached sign never turns itself and never collides with its own booth', () => {
  const b = booth('info')
  const sign = snapSignToBooth([b], wallSign(), points(b)[0], b.z)
  assert.ok(boothSupportsSign(b, sign))
  const turned = autofaceWallMount([], sign, [sign.x + 5, sign.y], [b])
  assert.equal(turned.rot, sign.rot, 'backed signs skip the wall-facing search')
  // The board is bolted to the **booth**, a named piece of the document, so the wall
  // search is not re-aimed onto a camera's wall either — nor is the aimed
  // 地面出入口's turn (`equipment-placement-input`).
  assert.equal(autofaceWallMount([], sign, [sign.x + 5, sign.y], [b], [-1, 0]).rot, sign.rot, 'and the camera cannot re-aim it')
  assert.equal(wallMountMissing([], sign, [b]), false)
  assert.deepEqual(placementColliders([sign], b), [], 'the booth shares its header with its own sign')
  assert.deepEqual(placementColliders([b], sign), [], 'either order exempts the pair')
})

test('pointing at the visible booth uses its frame instead of the floor behind it for preview and click', () => {
  const previous = useStore.getState()
  try {
    const b = booth('ticket')
    const state = toState({ name: 'test', cells: [], modules: [b], lines: [] })
    useStore.setState({ station: state, tool: 'module', moduleType: 'sign-wall', currentBoards: undefined,
      signPreview: null, signEditorOpen: false, past: [], future: [] })
    let preview
    let blocked
    const scene = new Proxy({
      pickModuleHit: () => ({ moduleId: b.id, point: [9, -5, 3.25] }),
      setModulePreview: (mod, invalid) => { preview = mod; blocked = invalid },
    }, { get: (obj, key) => obj[key] ?? (() => {}) })
    const ctx = { scene: () => scene, hover: { current: null }, drag: { current: null }, facing: () => undefined }
    const tool = new EquipmentTool(ctx)
    const info = { clientX: 100, clientY: 200, button: 0, preventDefault: () => {},
      hit: { cell: [20, 20, 0], place: [20, 20, 0], solid: true, normal: [0, 0, 1], point: [20.5, 20.5, 1] } }
    tool.onMove(info)
    assert.equal(blocked, false)
    assert.ok(boothSupportsSign(b, preview), 'preview follows the visible booth, not the far floor cell')
    tool.onDown(info)
    const placed = useStore.getState().station.modules.find((m) => m.type === 'sign')
    assert.ok(placed)
    assert.deepEqual({ ...placed, id: preview.id }, preview, 'click places exactly the snapped preview')
    const boards = { front: placed.cfg.front, back: [] }
    const edited = signModuleWithPreview(placed, { moduleId: placed.id, boards })
    assert.ok(boothSupportsSign(b, edited), 'live sign editing keeps the header attachment')
    useStore.getState().setSignBoards(placed.id, boards)
    const confirmed = useStore.getState().station.modules.find((m) => m.id === placed.id)
    assert.ok(boothSupportsSign(b, confirmed), 'confirming the editor keeps the attachment')
  } finally {
    useStore.setState(previous)
  }
})

test('the real camera ray returns the module id and visible world surface, but not through a block', () => {
  const { cam } = cameraRig()
  const moduleMeshes = new THREE.Group()
  const boothMesh = new THREE.Group(); boothMesh.userData.moduleId = 'counter'
  boothMesh.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshBasicMaterial()))
  moduleMeshes.add(boothMesh)
  cam.modules = { moduleMeshes }
  cam.camera.position.set(0, -5, 1); cam.camera.lookAt(0, 0, 1); cam.camera.updateMatrixWorld(true)
  const hit = cam.pickModuleHit(640, 410)
  assert.equal(hit?.moduleId, 'counter')
  assert.ok(Math.abs(hit.point[1] + 0.1) < 1e-6, 'the actual front face is returned for booth snapping')
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 4), new THREE.MeshBasicMaterial())
  wall.position.y = -1; wall.updateMatrixWorld(true); cam.setPickables([wall])
  assert.equal(cam.pickModuleHit(640, 410), null, 'nearer station geometry occludes a module ray')
  cam.dispose(); wall.geometry.dispose(); wall.material.dispose()
})
