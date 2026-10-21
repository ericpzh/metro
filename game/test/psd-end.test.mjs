import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createModule, toState } from '../src/build/model.ts'
import { emptyStation } from '../src/data/reference-station.ts'
import { isPsdEndCoverSupport, psdEndSpan, snapPsdEnd, snapPsdEndCover } from '../src/sim/psdEnds.ts'
import { edgeCells, rotateLocal } from '../src/sim/track.ts'
import { moduleEnvelope, equipmentReason, moduleFootprint, placementBlocked, moveCandidate, movedModule, blockReason } from '../src/sim/placement.ts'
import { buildGraph } from '../src/sim/station.ts'
import { useStore, placementPreviewKey, folderTiles } from '../src/app/store.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'
import { buildModule } from '../src/render/models.ts'
import { parse, serialize } from '../src/persistence/save.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { PickTool, paletteIdForModule } from '../src/app/tools/PickTool.ts'
import { PSD_HALF_HEIGHT, psdFullHeight } from '../src/sim/constants.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

// The grid a new station builds on. Every piece a test makes for one carries it —
// `toState` stamps it on the way in and the placement tool hands it to
// `createModule` — so both the model and the collision envelope read one grid.
const STOREY = emptyStation().storeyHeight
const panel = (rot = 0, psd = 'half') => ({ ...createModule('psd-end', 0, 0, 0, 'end', rot, undefined, 'up', 'lane', [], undefined, { storeyHeight: STOREY }), cfg: { psd } })
const screen = (rot = 0, side = 'left', psd = 'half') => ({ id: 'screen', type: 'platform-edge', x: 0, y: 0, z: 0, rot, w: 6, storeyHeight: STOREY, cfg: { line: '1', name: '', dir: 'up', side, psd } })

test('one decor tile switches height and refreshes a stationary ghost', () => {
  assert.ok(folderTiles('decor').some((t) => t.anchor === '__psd-end'))
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

test('屏蔽门盖板 snaps above full PSDs and stacks in one metre white courses', () => {
  const screenMod = screen(0, 'left', 'full')
  const draft = createModule('psd-end-cover', 0, 0, 0, 'cover')
  assert.equal(draft?.type, 'psd-end')
  assert.equal(draft?.cfg.variant, 'cover')
  assert.equal(paletteIdForModule(draft), 'psd-end-cover')
  assert.ok(folderTiles('decor').some((tile) => tile.anchor === '__psd-end'))
  const first = snapPsdEndCover(draft, [screenMod])
  assert.ok(first)
  assert.equal(first.z, 4)
  assert.equal(first.cfg.support, screenMod.id)
  assert.equal(equipmentReason([], [screenMod], first, true), '')
  const second = snapPsdEndCover({ ...first, id: 'cover-2', z: first.z, cfg: { ...first.cfg, support: undefined } }, [screenMod, first], [], first.id)
  assert.ok(second)
  assert.equal(second.z, first.z + 1)
  assert.equal(second.cfg.support, first.id)
  assert.equal(moduleEnvelope(second).z1 - moduleEnvelope(second).z0, 1)
  const saved = parse(serialize(toState({ ...emptyStation(), modules: [screenMod, first, second] })))
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.state.modules.slice(1), [first, second])
  assert.equal(snapPsdEndCover(draft, []), null, 'an unsupported cover cannot be placed')

  const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
  const group = buildModule(first, { mats, data: { ...emptyStation(), modules: [screenMod, first] }, trackCells: new Set(), finish: () => mats.steel, owned: [] })
  const panel = group.getObjectByName('psd-cover-panel')
  assert.ok(panel)
  assert.equal(panel.material, mats.white)
  panel.geometry.computeBoundingBox()
  assert.equal(panel.geometry.boundingBox.max.z - panel.geometry.boundingBox.min.z, 1)
})

test('clicking an existing cover previews and commits a dimension-matched upper course', () => {
  const before = useStore.getState()
  try {
    const s = screen(0, 'left', 'full')
    const end = { ...panel(0, 'full'), x: 2, cfg: { psd: 'full', corner: s.id, offset: [0.25, 0] } }
    const base = snapPsdEndCover(createModule('psd-end-cover', 2, 0, 0, 'base'), [s, end], [], end.id)
    useStore.setState({ station: toState({ ...emptyStation(), modules: [s, end, base] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    let preview
    const scene = { setModulePreview(mods) { preview = mods }, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, pickModule: () => base.id, hover: { current: null }, drag: { current: null } })
    const event = pointer()
    event.hit = null
    tool.onMove(event)
    assert.equal(preview.length, 1)
    assert.equal(preview[0].z, base.z + 1)
    assert.equal(preview[0].cfg.width, base.cfg.width)
    assert.equal(preview[0].cfg.depth, base.cfg.depth)
    assert.deepEqual(preview[0].cfg.offset, base.cfg.offset)
    assert.equal(equipmentReason(useStore.getState().station.cells, useStore.getState().station.modules, preview[0], true), '')
    tool.onDown(event)
    const upper = useStore.getState().station.modules.find((m) => m.type === 'psd-end' && m.cfg.support === base.id)
    assert.deepEqual(upper, preview[0])
  } finally { useStore.setState(before) }
})

test('屏蔽门盖板 matches a shortened 屏蔽端门 span and center', () => {
  const screenMod = screen(0, 'left', 'full')
  const end = {
    ...createModule('psd-end', 5, 0, 0, 'short-end', 0, undefined, 'up', 'lane', [], undefined, { storeyHeight: STOREY }),
    cfg: { psd: 'full', corner: screenMod.id, offset: [0.25, 0] },
  }
  const cover = snapPsdEndCover(createModule('psd-end-cover', 5, 0, 0, 'cover'), [screenMod, end], [], end.id)
  assert.ok(cover)
  assert.equal(cover.cfg.width, 0.75)
  assert.deepEqual(cover.cfg.offset, [0.125, 0])
  assert.ok(isPsdEndCoverSupport(cover, end))

  const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
  const group = buildModule(cover, { mats, data: { ...emptyStation(), modules: [screenMod, end, cover] }, trackCells: new Set(), finish: () => mats.steel, owned: [] })
  const panel = group.getObjectByName('psd-cover-panel')
  assert.ok(panel)
  panel.geometry.computeBoundingBox()
  assert.equal(panel.geometry.boundingBox.max.x - panel.geometry.boundingBox.min.x, 0.75)
  assert.equal(panel.position.x, 0.125)
})

test('屏蔽门盖板 applies across the whole run when the PSD is picked', () => {
  for (let rot = 0; rot < 4; rot++) {
    const before = useStore.getState()
    try {
      const screenMod = screen(rot, 'left', 'full')
      const [firstX, firstY] = edgeCells(screenMod)[0]
      const existing = snapPsdEndCover(createModule('psd-end-cover', firstX, firstY, screenMod.z, 'existing-cover'), [screenMod])
      useStore.setState({ station: toState({ ...emptyStation(), modules: [screenMod, existing] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
      const scene = { setModulePreview() {}, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
      const tool = new EquipmentTool({ scene: () => scene, pickModule: () => screenMod.id, hover: { current: null }, drag: { current: null } })
      const hit = pointer()
      hit.hit.solid = false
      tool.onDown(hit)
      const placed = useStore.getState().station.modules.filter((m) => m.type === 'psd-end' && m.cfg.variant === 'cover')
      assert.equal(placed.length, screenMod.w)
      assert.equal(new Set(placed.map((m) => m.id)).size, screenMod.w)
      assert.deepEqual(placed.map((m) => [m.x, m.y]), edgeCells(screenMod).map(([x, y]) => [x, y]))
      assert.ok(placed.every((m) => m.z === 4 && m.cfg.support === screenMod.id))
      assert.equal(useStore.getState().past.length, 1)
    } finally { useStore.setState(before) }
  }
})

test('picking the PSD run fills its terminal tile without snapping over a separate 屏蔽端门', () => {
  const before = useStore.getState()
  try {
    const screenMod = screen(0, 'left', 'full')
    const end = {
      ...createModule('psd-end', 5, 0, 0, 'terminal-end', 0, undefined, 'up', 'lane', [], undefined, { storeyHeight: STOREY }),
      cfg: { psd: 'full', corner: screenMod.id, offset: [0.25, 0] },
    }
    useStore.setState({ station: toState({ ...emptyStation(), modules: [screenMod, end] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    const scene = { setModulePreview() {}, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, pickModule: () => screenMod.id, hover: { current: null }, drag: { current: null } })
    const hit = pointer()
    hit.hit.solid = false
    tool.onDown(hit)
    const covers = useStore.getState().station.modules.filter((m) => m.type === 'psd-end' && m.cfg.variant === 'cover')
    assert.equal(covers.length, screenMod.w)
    const terminal = covers.find((m) => m.x === end.x && m.y === end.y)
    assert.ok(terminal, 'the terminal screen tile receives a cover')
    assert.equal(terminal.cfg.support, screenMod.id)
    assert.equal(terminal.cfg.width, undefined, 'PSD run covers keep the full tile width')
    assert.equal(terminal.cfg.offset, undefined, 'the end door does not pull the run cover off the PSD tile')
  } finally { useStore.setState(before) }
})

test('屏蔽门盖板 uses the picked upper PSD when levels share the same footprint', () => {
  const before = useStore.getState()
  try {
    const lower = screen(0, 'left', 'full')
    const upper = { ...screen(0, 'left', 'full'), id: 'upper-screen', z: STOREY }
    useStore.setState({ station: toState({ ...emptyStation(), modules: [lower, upper] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    const scene = { setModulePreview() {}, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, pickModule: () => upper.id, hover: { current: null }, drag: { current: null } })
    const hit = pointer()
    hit.hit.cell = [0, 0, STOREY]
    hit.hit.place = [0, 0, STOREY]
    hit.hit.solid = false
    tool.onDown(hit)
    const placed = useStore.getState().station.modules.filter((m) => m.type === 'psd-end' && m.cfg.variant === 'cover')
    assert.equal(placed.length, upper.w)
    assert.ok(placed.every((m) => m.z === STOREY + 4 && m.cfg.support === upper.id))
  } finally { useStore.setState(before) }
})

test('屏蔽门盖板 previews and snaps when 屏蔽端门 is picked', () => {
  const before = useStore.getState()
  try {
    const screenMod = screen(0, 'left', 'full')
    const end = {
      ...createModule('psd-end', 2, 0, 0, 'end', 0, undefined, 'up', 'lane', [], undefined, { storeyHeight: STOREY }),
      cfg: { psd: 'full', corner: screenMod.id, offset: [0.25, 0] },
    }
    useStore.setState({ station: toState({ ...emptyStation(), modules: [screenMod, end] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    const previews = []
    const scene = { setModulePreview(mods) { previews.push(mods) }, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    let picks = 0
    const tool = new EquipmentTool({ scene: () => scene, pickModule: (_x, _y, support) => { assert.equal(support, true); picks++; return end.id }, hover: { current: null }, drag: { current: null } })
    const hover = pointer()
    hover.hit = null
    tool.onMove(hover)
    const preview = previews.at(-1)
    assert.equal(picks, 1, 'the hover resolves the drawn module once')
    assert.equal(preview.length, 1)
    assert.equal(preview[0].cfg.support, end.id)
    assert.equal(preview[0].z, end.z + 1 + psdFullHeight(STOREY))
    assert.equal(preview[0].cfg.width, 0.75)
    assert.deepEqual(preview[0].cfg.offset, [0.125, 0])

    const click = pointer()
    click.hit = null
    tool.onDown(click)
    const placed = useStore.getState().station.modules.find((m) => m.type === 'psd-end' && m.cfg.variant === 'cover')
    assert.ok(placed)
    assert.equal(placed.cfg.support, end.id)
    assert.equal(placed.z, preview[0].z)
    assert.equal(placed.cfg.width, 0.75)
    assert.deepEqual(placed.cfg.offset, [0.125, 0])
    assert.equal(picks, 2, 'the press resolves the drawn module once')
  } finally { useStore.setState(before) }
})

test('the real snapped corner receives its own cover beside an already covered PSD run', () => {
  const before = useStore.getState()
  try {
    const s = screen(0, 'left', 'full')
    const end = snapPsdEnd(panel(1, 'full'), [s])
    assert.equal(end.cfg.corner, s.id)
    const run = edgeCells(s).map(([x, y, z], i) => snapPsdEndCover(createModule('psd-end-cover', x, y, z, `run-${i}`), [s], [], s.id))
    useStore.setState({ station: toState({ ...emptyStation(), modules: [s, end, ...run] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    let preview, blocked
    const scene = { setModulePreview(mods, refused) { preview = mods; blocked = refused }, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, pickModule: () => end.id, hover: { current: null }, drag: { current: null } })
    const event = pointer()
    event.hit = null
    tool.onMove(event)
    assert.equal(preview.length, 1, 'the PSD cover in the same tile does not suppress the corner cover')
    assert.equal(blocked, false, 'the fitted corner must clear the existing PSD cover')
    const candidate = preview[0]
    assert.equal(equipmentReason([], [s, end, ...run], candidate, true), '')
    const envelope = moduleEnvelope(candidate)
    assert.ok(Math.abs(envelope.x1 - envelope.x0 - 0.12) < 1e-6)
    assert.ok(Math.abs(envelope.y1 - envelope.y0 - 0.72) < 1e-6)
    const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
    const group = buildModule(candidate, { mats, data: { ...emptyStation(), modules: [s, end, ...run] }, trackCells: new Set(), finish: () => mats.steel, owned: [] })
    const bounds = new THREE.Box3().setFromObject(group)
    assert.ok(Math.abs(bounds.min.x - envelope.x0) < 1e-6)
    assert.ok(Math.abs(bounds.max.x - envelope.x1) < 1e-6)
    assert.ok(Math.abs(bounds.min.y - envelope.y0) < 1e-6)
    assert.ok(Math.abs(bounds.max.y - envelope.y1) < 1e-6)
    tool.onDown(event)
    const placed = useStore.getState().station.modules.filter((m) => m.type === 'psd-end' && m.cfg.support === end.id)
    assert.equal(placed.length, 1)
    assert.deepEqual(placed[0], candidate)
    tool.onDown(event)
    assert.equal(useStore.getState().past.length, 1, 'a repeated click does not duplicate the corner cover')
    const upper = snapPsdEndCover(createModule('psd-end-cover', 0, 0, 0, 'upper'), [placed[0]], [], placed[0].id)
    assert.equal(upper.cfg.width, candidate.cfg.width)
    assert.equal(upper.cfg.depth, candidate.cfg.depth)
  } finally { useStore.setState(before) }
})

test('corner covers clear the covered PSD at both endpoints, track sides and every rotation', () => {
  for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const at of [0, 5]) {
    const s = screen(rot, side, 'full')
    const [x, y] = edgeCells(s)[at]
    const end = snapPsdEnd({ ...panel((rot + 1) % 4, 'full'), x, y }, [s])
    assert.equal(end.cfg.corner, s.id)
    const run = edgeCells(s).map(([x, y, z], i) => snapPsdEndCover(createModule('psd-end-cover', x, y, z, `run-${i}`), [s], [], s.id))
    const cover = snapPsdEndCover(createModule('psd-end-cover', x, y, 0, 'corner-cover'), [s, end, ...run], [], end.id)
    assert.ok(cover.cfg.width > 0 && cover.cfg.depth > 0)
    assert.equal(equipmentReason([], [s, end, ...run], cover, true), '', `rotation ${rot}, ${side}, endpoint ${at}`)
  }
})

test('屏蔽门盖板 applies one tile when the ground is picked', () => {
  const before = useStore.getState()
  try {
    const screenMod = screen(0, 'left', 'full')
    useStore.setState({ station: toState({ ...emptyStation(), modules: [screenMod] }), tool: 'module', moduleType: 'psd-end-cover', past: [], future: [] })
    const scene = { setModulePreview() {}, setGhost() {}, setCursor() {}, setCollisionHighlight() {}, setFencePreview() {} }
    const tool = new EquipmentTool({ scene: () => scene, pickModule: () => null, hover: { current: null }, drag: { current: null } })
    const hit = pointer()
    hit.hit.cell = [2, 0, 0]
    hit.hit.place = [2, 0, 0]
    hit.hit.solid = true
    tool.onDown(hit)
    const placed = useStore.getState().station.modules.filter((m) => m.type === 'psd-end' && m.cfg.variant === 'cover')
    assert.equal(placed.length, 1)
    assert.equal(placed[0].x, 2)
    assert.equal(placed[0].z, 4)
    assert.equal(placed[0].cfg.support, screenMod.id)
    assert.equal(useStore.getState().past.length, 1)
  } finally { useStore.setState(before) }
})

test('a ground click on an upper platform snaps to that level PSD', () => {
  const lower = screen(0, 'left', 'full')
  const upper = { ...screen(0, 'left', 'full'), id: 'upper-screen', z: STOREY }
  const draft = createModule('psd-end-cover', 2, 0, STOREY, 'upper-cover')
  const snapped = snapPsdEndCover(draft, [lower, upper])
  assert.ok(snapped)
  assert.equal(snapped.z, STOREY + 4)
  assert.equal(snapped.cfg.support, upper.id)
})

test('neighbouring screens never stretch a panel beyond its own metre', () => {
  for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const direction of [-1, 1]) {
    const p = panel(rot, psd)
    const [x, y] = rotateLocal(rot, direction, 0)
    const s = { ...screen((rot + 1) % 4, side, psd), x, y }
    const span = psdEndSpan(p, [p, s])
    assert.deepEqual(span, [-0.5, 0.5], 'a neighbouring screen cannot enlarge the tile piece')
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
    assert.ok(Math.abs(envelope.z1 - envelope.z0 - (psd === 'half' ? PSD_HALF_HEIGHT : psdFullHeight(STOREY))) < 1e-9)
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
      // Full glazing fills the space below the top information plate.
      const paneH = psd === 'half' ? 1.28 : 2.35
      assert.ok(Math.abs(glass[0].geometry.parameters.height - paneH) < 1e-9)
      assert.deepEqual(g.userData.doors, [])
      assert.ok(g.children.filter(c=>c.name!=='psd-concrete-foundation').every((c) => c.userData.wall))
      const reference = buildModule({ ...screen(0, 'left', psd), w: 1 }, ctx)
      assert.ok(Math.abs(new THREE.Box3().setFromObject(g).max.z - new THREE.Box3().setFromObject(reference).max.z) < 1e-6)
    }
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old }
})

test('corner glass is shortened and all frame meshes stay inside their tile', () => {
  const old = globalThis.document
  globalThis.document = { createElement: () => { const { g } = stubCanvas(); return { width: 0, height: 0, getContext: () => g } } }
  try {
    const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
    for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const atEnd of [false, true]) {
      const s = screen(rot, side, psd)
      const [x, y] = rotateLocal(rot, atEnd ? s.w - 1 : 0, 0)
      for (const turn of [1, 3]) {
        const p = snapPsdEnd({ ...panel((rot + turn) % 4, psd), x, y }, [s])
        const [dx, dy] = rotateLocal(rot, 0, side === 'right' ? -1 : 1)
        const next = snapPsdEnd({ ...p, id: 'next', x: x + dx, y: y + dy }, [s, p])
        const ctx = { mats, data: { ...emptyStation(), modules: [s, p, next] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
        for (const m of [s, p, next]) {
          const g = buildModule(m, ctx)
          const glass = g.children.find((c) => c.name === 'psd-fixed-glass')
          if (m !== s) assert.ok(Math.abs(glass.geometry.parameters.width - (m === p ? 0.84 : 1)) < 1e-9, 'only the corner is shorter than a metre')
          const bounds = new THREE.Box3().setFromObject(g)
          if (m !== s) {
            assert.ok(bounds.min.x >= m.x - 1e-6 && bounds.max.x <= m.x + 1 + 1e-6, 'cap/frame never protrude along x')
            assert.ok(bounds.min.y >= m.y - 1e-6 && bounds.max.y <= m.y + 1 + 1e-6, 'cap/frame never protrude along y')
          }
          const envelope = moduleEnvelope(m)
          // The first whole course the screen leaves free: on a five-metre station a
          // full screen's glass tops out exactly on the storey's ceiling plane, and a
          // half screen leaves the 3 m course above its 2.45 m reservation.
          const ceilingZ = m.z + Math.ceil(envelope.z1 - m.z)
          assert.ok(bounds.max.z <= ceilingZ + 1e-6, 'the complete screen fits below the overhead block')
          assert.ok(Math.abs(bounds.max.z - envelope.z1) < 1e-6, 'the cap stays inside the placement reservation')
          assert.equal(blockReason([], [m], m.x, m.y, ceilingZ).ok, true, 'the overhead block can be placed')
          if (m !== s) assert.equal(blockReason([], [m], m.x, m.y, ceilingZ - 1).ok, false, 'a block inside the extension is still refused')
        }
      }
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

test('trimmed extension fittings have no competing coplanar faces', () => {
  const old = globalThis.document
  globalThis.document = { createElement: () => { const { g } = stubCanvas(); return { width: 0, height: 0, getContext: () => g } } }
  try {
    const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
    for (const psd of ['half', 'full']) for (let rot = 0; rot < 4; rot++) for (const side of ['left', 'right']) for (const atEnd of [false, true]) for (const turn of [1, 3]) {
      const s = screen(rot, side, psd)
      const [x, y] = rotateLocal(rot, atEnd ? s.w - 1 : 0, 0)
      const corner = snapPsdEnd({ ...panel((rot + turn) % 4, psd), x, y }, [s])
      const [dx, dy] = rotateLocal(rot, 0, side === 'right' ? -1 : 1)
      const next = snapPsdEnd({ ...corner, id: 'next', x: x + dx, y: y + dy, rot: (corner.rot + 2) % 4 }, [s, corner])
      const ctx = { mats, data: { ...emptyStation(), modules: [s, corner, next] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
      for (const p of [corner, next]) {
        const g = buildModule(p, ctx)
        const screenGroup = buildModule(s, ctx)
        screenGroup.updateMatrixWorld(true)
        g.updateMatrixWorld(true)
        if (p === corner) {
          const [ox] = p.cfg.offset
          const span = psdEndSpan(p)
          for (const [height, material, depth] of psd === 'full'
            ? [[3.8, mats.white, 0.12], [3.975, mats.black, 0.14]]
            : [[0.99, mats.black, 0.09], [2.425, mats.black, 0.05]]) {
            const fitting = g.children.find((c) => {
              if (c.material !== material || !(c.geometry instanceof THREE.BoxGeometry)) return false
              c.updateMatrix()
              const bounds = c.geometry.boundingBox.clone().applyMatrix4(c.matrix)
              return bounds.min.z < height && bounds.max.z > height
            })
            assert.ok(fitting, 'the corner retains its fascia/cap')
            const bounds = fitting.geometry.boundingBox.clone().applyMatrix4(fitting.matrix)
            const end = ox > 0 ? bounds.min.x : bounds.max.x
            const contact = ox > 0 ? span[0] + ox + depth : span[1] + ox - depth
            assert.ok(Math.abs(end - contact) < 1e-6, 'fascia/cap meets the actual housing face without a clearance slit')
          }
        }
        for (const fitting of g.children.filter((c) => c.geometry instanceof THREE.BoxGeometry)) {
          const bounds = new THREE.Box3().setFromObject(fitting)
          for (const housing of screenGroup.children.filter((c) => c.geometry instanceof THREE.BoxGeometry && c.name !== 'platform-yellow-line')) {
            const other = new THREE.Box3().setFromObject(housing)
            assert.ok(!['x', 'y', 'z'].every((key) => Math.min(bounds.max[key], other.max[key]) - Math.max(bounds.min[key], other.min[key]) > 1e-6), `extension fittings clear the ${psd} screen housing at rotation ${rot}, ${side} side, turn ${turn}: ${fitting.name} vs ${housing.name}`)
          }
        }
        const boxes = g.children.filter((c) => c.geometry instanceof THREE.BoxGeometry).map((mesh) => {
          mesh.updateMatrix()
          return { mesh, bounds: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix) }
        })
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j]
          if (a.mesh.material === b.mesh.material) continue
          for (const axis of ['x', 'y', 'z']) for (const face of ['min', 'max']) {
            if (Math.abs(a.bounds[face][axis] - b.bounds[face][axis]) > 1e-6) continue
            const others = ['x', 'y', 'z'].filter((key) => key !== axis)
            assert.ok(!others.every((key) => Math.min(a.bounds.max[key], b.bounds.max[key]) - Math.max(a.bounds.min[key], b.bounds.min[key]) > 1e-6), `${psd} fittings must not overlap on the same ${axis} face`)
          }
        }
        const glass = g.children.find((c) => c.name === 'psd-fixed-glass')
        assert.ok(Math.abs(glass.position.y - (-0.34 + p.cfg.offset[1])) < 1e-9, 'the glass retains its snapped plane')
      }
    }
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old }
})

test('PSD exposed ends have a single visible fitting face and preserve sliding leaves', () => {
  const old = globalThis.document
  globalThis.document = { createElement: () => { const { g } = stubCanvas(); return { width: 0, height: 0, getContext: () => g } } }
  try {
    const mats = new Proxy({}, { get: (t, k) => t[k] ??= new THREE.MeshStandardMaterial() })
    for (const psd of ['half', 'full']) for (const side of ['left', 'right']) {
      const p = screen(0, side, psd)
      const ctx = { mats, data: { ...emptyStation(), modules: [p] }, trackCells: new Set(), finish: () => mats.steel, owned: [] }
      const g = buildModule(p, ctx)
      g.updateMatrixWorld(true)
      const fixed = g.children.filter((c) => c.geometry instanceof THREE.BoxGeometry && c.userData.closedX === undefined)
      for (const direction of [-1, 1]) for (const offset of [-0.045, 0.013, 0.043]) for (const z of [1.11, 1.13, 1.16, 2.35, 2.425, 3.585, 3.63, 3.67, 3.8]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(direction < 0 ? -1 : p.w + 1, 0.5 + (side === 'left' ? -0.34 : 0.34) + offset, z), new THREE.Vector3(-direction, 0, 0))
        const hits = ray.intersectObjects(fixed)
        for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
          if (hits[i].object === hits[j].object) continue
          assert.ok(Math.abs(hits[i].distance - hits[j].distance) > 1e-6, 'an end-view ray must not see competing coplanar fitting faces')
        }
      }
      for (const leaf of g.userData.doors.filter((c) => c.geometry instanceof THREE.BoxGeometry)) {
        assert.equal(leaf.geometry.getAttribute('position').count, 24, 'moving fittings keep their complete box faces')
      }
    }
  } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old }
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

test('curtain wall has one tile beside the screen end, four Tab widths, and pick restores its width', () => {
  const tiles = folderTiles('decor').map((t) => t.anchor)
  const index = tiles.indexOf('__psd-end')
  assert.equal(index % 2, 0)
  assert.equal(tiles[index + 1], 'curtain-wall')
  const before = useStore.getState()
  try {
    useStore.setState({ curtainWidth: 2 })
    for (const width of [2, 3, 4, 1]) {
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
      assert.deepEqual(psdEndSpan(extension), [-0.5, 0.5], 'each continuation stays exactly one metre')
      assert.equal(extension.cfg.offset[0], 0, 'do not inherit the corner length offset')
      for (const m of [first, extension]) {
        const bounds = moduleEnvelope(m)
        assert.ok(bounds.x0 >= m.x - 1e-6 && bounds.x1 <= m.x + 1 + 1e-6)
        assert.ok(bounds.y0 >= m.y - 1e-6 && bounds.y1 <= m.y + 1 + 1e-6)
        for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          assert.equal(blockReason([], [m], m.x + nx, m.y + ny, 1).ok, true, 'every neighbouring tile accepts a block')
          const equipment = createModule('tvm', m.x + nx, m.y + ny, 0, 'neighbour', 0)
          assert.equal(placementBlocked([m], equipment), false, 'every neighbouring tile accepts equipment')
        }
      }
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

test('the first snapped panel trims at the tile edge', () => {
  const s = screen()
  const snapped = snapPsdEnd(panel(1), [s])
  assert.ok(snapped.cfg.offset, 'the corner snap shifts the panel inside its tile')
  const [a, b] = psdEndSpan(snapped, [snapped, s])
  assert.ok(Math.abs(b - a - 0.84) < 1e-9, 'the corner is 0.84 m; the following panels are 1 m')
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
