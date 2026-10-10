import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { psdEndSpan, snapPsdEnd } from '../src/sim/psdEnds.ts'
import { rotateLocal } from '../src/sim/track.ts'
import { moduleEnvelope, equipmentReason, moduleFootprint, placementBlocked, moveCandidate, movedModule } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { useStore, placementPreviewKey, folderTiles } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { PickTool } from '../src/app/tools/PickTool.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

const panel = (rot = 0, psd = 'half') => ({ ...createModule('psd-end', 0, 0, 0, 'end', rot), cfg: { psd } })
const screen = (rot = 0, side = 'left', psd = 'half') => ({ id: 'screen', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 6, cfg: { line: '1', name: '', dir: 'up', side, psd } })

test('one decor tile switches height and refreshes a stationary ghost', () => {
  assert.ok(folderTiles('decor').some((t) => t.anchor === 'psd-end'))
  const before = useStore.getState().psdEndHeight
  try {
    useStore.setState({ psdEndHeight: 'half' })
    const key = placementPreviewKey(useStore.getState())
    useStore.getState().cyclePsdEndHeight()
    assert.equal(useStore.getState().psdEndHeight, 'full')
    assert.notEqual(placementPreviewKey(useStore.getState()), key)
    useStore.getState().cyclePsdEndHeight()
    assert.equal(useStore.getState().psdEndHeight, 'half')
    assert.notEqual(moduleGhostKey(panel(0, 'half')), moduleGhostKey(panel(0, 'full')))
  } finally { useStore.setState({ psdEndHeight: before }) }
})

test('glass planes meet at 90 degrees in every rotation and screen side', () => {
  for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const direction of [-1, 1]) {
    const p = panel(rot, psd)
    const [x, y] = rotateLocal(rot, direction, 0)
    const s = { ...screen((rot + 1) % 4, side, psd), x, y }
    const [wx] = rotateLocal(1, 0, side === 'left' ? -0.34 : 0.34)
    const cross = direction + wx
    const span = psdEndSpan(p, [p, s])
    if (Math.abs(cross) <= 0.84) assert.ok(Math.abs((direction < 0 ? span[0] : span[1]) - cross) < 1e-9)
    else assert.deepEqual(span, [-0.5, 0.5], 'do not bridge empty ground')
    assert.equal(equipmentReason([], [s], p, true), '', 'corner placement is legal')
  }
  assert.deepEqual(psdEndSpan(panel(), [{ ...screen(1), x: 1, z: 4 }]), [-0.5, 0.5])
  assert.deepEqual(psdEndSpan(panel(), [{ ...screen(1, 'left', 'full'), x: 1 }]), [-0.5, 0.5])
})

test('fixed glass blocks walking and keeps both heights through save/load', () => {
  for (const psd of ['half', 'full']) {
    const p = panel(0, psd)
    assert.deepEqual(moduleFootprint(p), [[0, 0]])
    const envelope = moduleEnvelope(p)
    assert.ok(Math.abs(envelope.z1 - envelope.z0 - (psd === 'half' ? 1.5 : 3.1)) < 1e-9)
    const data = { ...emptyStation(), modules: [p] }
    assert.equal(buildGraph(data).nodeIndex.has('0,0,0'), false)
    const loaded = parse(serialize(toState(data)))
    assert.equal(loaded.ok, true)
    assert.deepEqual(loaded.state.modules.find((m) => m.id === p.id), p)
  }
})

test('model reuses screen fixed glass, matches its cap height, and has no sliding leaves', () => {
  const old = globalThis.document
  globalThis.document = { createElement: () => { const { g } = stubCanvas(); return { width: 0, height: 0, getContext: () => g } } }
  try {
    for (const psd of ['half', 'full']) {
      const p = panel(0, psd)
      const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
      const ctx = { mats, data: { ...emptyStation(), modules: [p] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
      const g = buildModule(p, ctx)
      const glass = g.children.filter((c) => c.name === 'psd-fixed-glass')
      assert.equal(glass.length, 1)
      assert.equal(glass[0].geometry.parameters.width, 1)
      assert.equal(glass[0].geometry.parameters.height, psd === 'half' ? 1.26 : 2.5)
      assert.deepEqual(g.userData.doors, [])
      assert.ok(g.children.every((c) => c.userData.wall))
      const reference = buildModule({ ...screen(0, 'left', psd), w: 1 }, ctx)
      assert.ok(Math.abs(new THREE.Box3().setFromObject(g).max.z - new THREE.Box3().setFromObject(reference).max.z) < 1e-6)
    }
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old }
})

test('a snapped return draws shifted onto the shared endpoint tile', () => {
  const old = globalThis.document
  globalThis.document = { createElement: () => { const { g } = stubCanvas(); return { width: 0, height: 0, getContext: () => g } } }
  try {
    // A corner snap carries the half-metre offset into the screen's tile, and
    // the model shifts the whole return onto it rather than drawing centred.
    const p = { ...panel(0, 'half'), cfg: { psd: 'half', corner: 'screen', offset: [0.25, -0.25] } }
    const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
    const ctx = { mats, data: { ...emptyStation(), modules: [p] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
    const g = buildModule(p, ctx)
    const plain = buildModule(panel(0, 'half'), ctx)
    assert.ok(g.children.length > 0, 'the snapped return drew nothing to shift')
    for (let i = 0; i < g.children.length; i++) {
      assert.ok(Math.abs(g.children[i].position.x - plain.children[i].position.x - 0.25) < 1e-9)
      assert.ok(Math.abs(g.children[i].position.y - plain.children[i].position.y + 0.25) < 1e-9)
    }
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old }
})


test('snap shares the screen endpoint tile in every rotation, end and track side', () => {
  for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const atEnd of [false, true]) {
    const screenMod = screen(rot, side, psd)
    const [x, y] = rotateLocal(rot, atEnd ? screenMod.w - 1 : 0, 0)
    for (const turn of [1, 3]) {
      const p = { ...panel((rot + turn) % 4, psd), x, y }
      const snapped = snapPsdEnd(p, [screenMod])
      assert.equal(snapped.cfg.corner, screenMod.id)
      assert.equal(equipmentReason([], [screenMod], snapped, true), '')
      assert.equal(placementBlocked([snapped], { ...snapped, id: 'duplicate' }), true)
      const [ax, ay] = rotateLocal(snapped.rot, snapped.cfg.offset[0], snapped.cfg.offset[1] - 0.34)
      const [tx, ty] = rotateLocal(snapped.rot, 0.5, 0)
      const worldEnds = [[x + 0.5 + ax - tx, y + 0.5 + ay - ty], [x + 0.5 + ax + tx, y + 0.5 + ay + ty]]
      const [ex, ey] = rotateLocal(rot, atEnd ? screenMod.w - 0.5 : -0.5, side === 'left' ? -0.34 : 0.34)
      assert.ok(worldEnds.some(([wx, wy]) => Math.hypot(wx - screenMod.x - 0.5 - ex, wy - screenMod.y - 0.5 - ey) < 1e-6), 'a glass end meets the actual run corner')
    }
  }
  assert.equal(snapPsdEnd({ ...panel(1), x: 3 }, [screen()]).cfg.corner, undefined, 'no snap through the middle of the run')
  assert.equal(snapPsdEnd(panel(0), [screen()]).cfg.corner, undefined, 'parallel panel is not a corner')
})

function pointer() { return { button: 0, clientX: 0, clientY: 0, buttons: 0, preventDefault() {}, hit: { cell: [0, 0, 0], place: [0, 0, 1], point: [0.5, 0.5, 1], solid: true } } }

test('the corner hover is accepted and the click commits the same snapped pose', () => {
  const before = useStore.getState()
  try {
    const s = screen()
    useStore.setState({ station: toState({ ...emptyStation(), modules: [s] }), tool: 'module', moduleType: 'psd-end', moduleRot: 1, psdEndHeight: 'half', past: [], future: [] })
    let ghost, refused
    const scene = { setModulePreview: (mods, blocked) => { ghost = Array.isArray(mods) ? mods[0] : mods; refused = blocked }, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, hover: { current: null }, drag: { current: null } })
    tool.onMove(pointer())
    assert.equal(refused, false)
    assert.equal(ghost.cfg.corner, s.id)
    tool.onDown(pointer())
    const placed = useStore.getState().station.modules.find((m) => m.type === 'psd-end')
    assert.ok(placed, 'the shared corner must be placeable')
    assert.deepEqual(placed.cfg, ghost.cfg)
    assert.equal(useStore.getState().past.length, 1)
    const restored = parse(serialize(useStore.getState().station))
    assert.deepEqual(restored.state.modules.find((m) => m.id === placed.id).cfg, placed.cfg)
    useStore.getState().undo()
    assert.deepEqual(useStore.getState().station.modules, [s])
  } finally { useStore.setState(before) }
})

test('curtain wall has one tile beside the screen end, three Tab widths, and pick restores its width', () => {
  const tiles = folderTiles('decor').map((t) => t.anchor)
  const index = tiles.indexOf('psd-end')
  assert.equal(index % 2, 0)
  assert.equal(tiles[index + 1], 'curtain-wall')
  const before = useStore.getState()
  try {
    useStore.setState({ curtainWidth: 2 })
    for (const width of [2, 3, 4]) {
      assert.equal(useStore.getState().curtainWidth, width)
      const p = createModule('curtain-wall', 0, 0, 0, 'wall', 0, width)
      assert.equal(p.w, width)
      assert.equal(p.cfg.variant, `${width}x4`)
      assert.equal(equipmentReason([], [], p), '')
      const key = placementPreviewKey(useStore.getState())
      useStore.getState().cycleCurtainWidth()
      assert.notEqual(placementPreviewKey(useStore.getState()), key)
    }
    assert.equal(useStore.getState().curtainWidth, 2)
    const p = createModule('curtain-wall', 0, 0, 0, 'wall', 0, 4)
    useStore.setState({ station: toState({ ...emptyStation(), modules: [p] }), curtainWidth: 2, pickDraft: null })
    const scene = { setGhost() {}, setCursor() {}, setModulePreview() {}, setCollisionHighlight() {} }
    const picker = new PickTool({ scene: () => scene, pickModule: () => p.id, drag: { current: null }, hover: { current: null }, facing: () => undefined })
    picker.onDown(pointer())
    assert.equal(useStore.getState().moduleType, 'curtain-wall')
    assert.equal(useStore.getState().curtainWidth, 4)
    useStore.getState().cancelPick()
    assert.equal(useStore.getState().curtainWidth, 2)
  } finally { useStore.setState(before) }
})


test('a corner return extends through successive tiles without losing its snapped glass plane', () => {
  for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const atEnd of [false, true]) {
    const s = screen(rot, side, psd)
    const [x, y] = rotateLocal(rot, atEnd ? s.w - 1 : 0, 0)
    const first = snapPsdEnd({ ...panel((rot + 1) % 4, psd), x, y }, [s])
    const toward = side === 'right' ? -1 : 1
    const [dx, dy] = rotateLocal(rot, 0, toward)
    const modules = [s, first]
    for (let i = 1; i <= 4; i++) {
      // A reversed placement rotation still extends the same glass plane.
      const p = { ...panel((first.rot + (i % 2) * 2) % 4, psd), id: `extend-${i}`, x: x + dx * i, y: y + dy * i }
      const extension = snapPsdEnd(p, modules)
      assert.ok(extension.cfg.offset, 'carry the in-cell snap into the next tile')
      assert.equal(equipmentReason([], modules, extension, true), '')
      const last = modules.at(-1)
      const box = moduleEnvelope(extension)
      const previous = moduleEnvelope(last)
      assert.ok(Math.abs(dx ? (dx > 0 ? box.x0 - previous.x1 : box.x1 - previous.x0) : (dy > 0 ? box.y0 - previous.y1 : box.y1 - previous.y0)) < 1e-6, 'panel ends touch with no gap or overlap')
      assert.equal(placementBlocked([extension], { ...extension, id: 'duplicate' }), true)
      modules.push(extension)
    }
    const restored = parse(serialize(toState({ ...emptyStation(), modules })))
    assert.deepEqual(restored.state.modules, JSON.parse(JSON.stringify(modules)))
  }
})

test('a lifted screen return re-snaps through the move path, not just the placement hover', () => {
  const before = useStore.getState()
  try {
    const s = screen()
    const station = toState({ ...emptyStation(), modules: [s] })
    useStore.setState({ station, tool: 'module', moduleType: 'psd-end', moduleRot: 1, past: [], future: [] })
    const carried = panel(1)
    const { module: candidate, reason } = moveCandidate(station.cells, station.modules, carried, { x: 0, y: 0, z: 0 }, 1)
    assert.equal(reason, '', 'the shared corner must be a legal drop')
    assert.equal(candidate.cfg.corner, s.id, 'the move path re-snaps like the hover')
    assert.deepEqual(candidate.cfg, snapPsdEnd({ ...carried, x: 0, y: 0, z: 0, rot: 1 }, [s]).cfg)
    assert.equal(movedModule(carried, { x: 0, y: 0, z: 0 }, 1).cfg.corner, undefined, 'the raw translation carries no snap of its own')
  } finally { useStore.setState(before) }
})

test('a snapped panel keeps the default span instead of reaching for the glass', () => {
  const s = screen()
  const snapped = snapPsdEnd(panel(1), [s])
  assert.ok(snapped.cfg.offset, 'the corner snap shifts the panel inside its tile')
  assert.deepEqual(psdEndSpan(snapped, [snapped, s]), [-0.5, 0.5], 'an in-cell offset panel never extends its span')
})

test('hover and click extend the snapped return, and undo removes only the extension', () => {
  const before = useStore.getState()
  try {
    const s = screen(0, 'left', 'full')
    const first = snapPsdEnd(panel(1, 'full'), [s])
    useStore.setState({ station: toState({ ...emptyStation(), modules: [s, first] }), tool: 'module', moduleType: 'psd-end', moduleRot: 1, psdEndHeight: 'full', past: [], future: [] })
    let ghost, refused
    const scene = { setModulePreview: (mods, blocked) => { ghost = Array.isArray(mods) ? mods[0] : mods; refused = blocked }, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, hover: { current: null }, drag: { current: null } })
    const event = pointer()
    event.hit = { ...event.hit, cell: [0, 1, 0], place: [0, 1, 1], point: [0.5, 1.5, 1] }
    tool.onMove(event)
    assert.equal(refused, false, 'the next panel must not show a red overlap ghost')
    tool.onDown(event)
    const modules = useStore.getState().station.modules
    assert.equal(modules.length, 3)
    assert.deepEqual(modules[2].cfg, ghost.cfg)
    useStore.getState().undo()
    assert.deepEqual(useStore.getState().station.modules, [s, first])
  } finally { useStore.setState(before) }
})
