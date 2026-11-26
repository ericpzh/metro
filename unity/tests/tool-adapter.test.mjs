// Plan 27 §2 at the shell boundary: the typed tool adapter is the one translation between the
// shared UI's tool state and the host's committed tool session.
//
// Three behaviours are load-bearing and pinned here:
//
// * the **canonical** name travels (`block`, not the old `floor`), because the host normalizes
//   the legacy alias at its own boundary;
// * **every** setting rides the same command — a missing cut mode or ring toggle draws the
//   wrong ghost under a still pointer, and nothing but a move would correct it;
// * adopting the host's committed tool never echoes a `tool.set`, which would replace the
//   host's own settings with the rail's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createToolAdapter,
  rightClaimedByTool,
  settingsFor,
  settingsKey,
  shellToolFor,
} from '../../game/src/unity-web/toolAdapter.ts'
import { adoptPickedFace, adoptPickedModule } from '../../game/src/app/tools/PickTool.ts'
import { parseHostPick } from '../../game/src/unity-web/pickAdoption.ts'
import { useStore } from '../../game/src/app/store.ts'

/** A store-shaped state: only the fields the adapter reads, all at their defaults. */
function toolState(overrides = {}) {
  return {
    tool: 'select',
    moduleType: 'gate',
    moduleRot: 0,
    gateDoor: 'lane',
    curtainWidth: 2,
    curtainHeight: 4,
    doorWide: false,
    stairWidth: 1,
    stairBlockHeight: 1,
    pillarLength: 2,
    roofWidth: 4,
    roofPlateSnap: 'upper',
    escalatorDir: 'up',
    escalatorWidth: 1,
    escalatorSpan: 'single',
    rampLength: 8,
    doubleRampLength: 9,
    tripleRampLength: 9,
    liftInterval: 5,
    liftSize: 2,
    liftStyle: 'glass',
    walkwayLength: 8,
    bridgeLength: 32,
    bridgeRailing: 'railing',
    counterLength: 1,
    hangerLength: 4,
    psdEndHeight: 'half',
    lightPosition: 0,
    calligraphyEnglish: false,
    guideExitId: null,
    roadWidth: 6,
    roadDirection: 'two-way',
    lineSpacing: 0,
    zoneBrush: { mode: 'area', kind: 'concourse' },
    facilityRot: 0,
    wallSnapCycle: 0,
    halfWall: false,
    halfCorner: false,
    triangles: false,
    triKind: 'upper',
    autoWalls: false,
    suspendedCeiling: false,
    railLineId: '',
    railDir: 'up',
    railRot: 0,
    railCatenaryStyle: 'canopy',
    tunnelLength: 32,
    paintMode: 'single',
    paintBaseMode: 'finish',
    paintFinish: 'floor.concrete',
    ...overrides,
  }
}

function setup(state) {
  const sent = []
  let listener = null
  let current = state
  const adapter = createToolAdapter({
    read: () => current,
    send: (tool, settings) => sent.push({ tool, settings }),
    subscribe: callback => { listener = callback; return () => { listener = null } },
    applyHostTool: tool => {
      current = { ...current, tool }
      // A real store notifies its subscribers on every set.
      listener?.()
    },
  })
  const set = next => { current = { ...current, ...next } }
  const notify = () => listener?.()
  return { adapter, sent, set, notify, read: () => current }
}

test('the canonical web tool name is what reaches the host', () => {
  const { adapter, sent } = setup(toolState({ tool: 'block' }))
  try {
    // No legacy mapping: the host owns `floor` → `block` and `gate` → `module` itself.
    assert.equal(sent.length, 1)
    assert.equal(sent[0].tool, 'block')
  } finally {
    adapter.dispose()
  }
})

test('the whole tool state rides the command, not just the palette id', () => {
  const { adapter, sent } = setup(toolState({ tool: 'block', halfWall: true, wallSnapCycle: 2, autoWalls: false }))
  try {
    const settings = sent[0].settings
    assert.equal(settings.moduleType, 'gate')
    assert.equal(settings.rotation, 0)
    // The block brush's modes: these are what F's ghost is drawn from.
    assert.equal(settings.halfWall, true)
    assert.equal(settings.wallSnapCycle, 2)
    assert.equal(settings.halfCorner, false)
    assert.equal(settings.triangles, false)
    assert.equal(settings.triKind, 'upper')
    assert.equal(settings.autoWalls, false)
    assert.equal(settings.suspendedCeiling, false)
    // The rest of the catalogue's settings travel too, so a later port does not need a
    // protocol change to read them.
    assert.equal(settings.lineId, '')
    assert.equal(settings.gateDoor, 'lane')
    assert.equal(settings.curtainHeight, 4)
    assert.equal(settings.railDir, 'up')
    assert.equal(settings.paintMode, 'single')
    assert.equal(typeof settings.zoneBrush, 'string')
  } finally {
    adapter.dispose()
  }
})

test('one command per real change, and an unchanged state never re-sends', () => {
  const { adapter, sent, set, notify } = setup(toolState({ tool: 'block' }))
  try {
    assert.equal(sent.length, 1)
    // A store notification with identical tool state is not a new command.
    notify()
    assert.equal(sent.length, 1)
    set({ wallSnapCycle: 1 })
    notify()
    assert.equal(sent.length, 2, 'R stepped the committed orientation')
    assert.equal(sent[1].settings.wallSnapCycle, 1)
    set({ tool: 'select' })
    notify()
    assert.equal(sent.length, 3)
    assert.equal(sent[2].tool, 'select')
  } finally {
    adapter.dispose()
  }
})

test('adopting the host\u2019s tool moves the store without echoing a tool.set', () => {
  const { adapter, sent, read } = setup(toolState({ tool: 'select' }))
  try {
    assert.equal(sent.length, 1)
    assert.equal(adapter.adoptHostTool('block'), true)
    assert.equal(read().tool, 'block', 'the rail follows the host')
    assert.equal(sent.length, 1, 'the adoption must not replace the host\u2019s own settings')
    // A repeated adoption of the same value is a no-op.
    assert.equal(adapter.adoptHostTool('block'), false)
    // A name with no store equivalent is ignored, and the session stays where it is.
    assert.equal(adapter.adoptHostTool('inspect'), false)
    assert.equal(read().tool, 'block')
    // A later real change still sends.
    assert.equal(adapter.adoptHostTool('move'), true)
    assert.equal(read().tool, 'move')
    assert.equal(sent.length, 1)
  } finally {
    adapter.dispose()
  }
})

test('a settings key is stable and covers the tool and every setting', () => {
  const settings = settingsFor(toolState({ tool: 'block' }))
  assert.equal(settingsKey('block', settings), settingsKey('block', settingsFor(toolState({ tool: 'block' }))))
  assert.notEqual(settingsKey('block', settings), settingsKey('wall', settings))
  const rotated = settingsFor(toolState({ tool: 'block', wallSnapCycle: 3 }))
  assert.notEqual(settingsKey('block', settings), settingsKey('block', rotated))
})

test('only an erase claim takes the right button from the camera', () => {
  assert.equal(rightClaimedByTool('erase'), true)
  // A cancel claim is a right *tap*; a drag still pans, so the camera keeps the button.
  assert.equal(rightClaimedByTool('cancel'), false)
  assert.equal(rightClaimedByTool('pan'), false)
  assert.equal(rightClaimedByTool(undefined), false)
})

test('the shell tool mapping names only the tools this host shares', () => {
  for (const tool of ['select', 'pick', 'move', 'block', 'wall', 'delete', 'module', 'paint', 'zone', 'rail', 'tunnel']) {
    assert.equal(shellToolFor(tool), tool)
  }
  // `inspect` and the unported tools have no store equivalent: the rail keeps its own tool.
  assert.equal(shellToolFor('inspect'), null)
  assert.equal(shellToolFor('floor'), null, 'the legacy alias is normalized at the host boundary')
  assert.equal(shellToolFor('gate'), null)
})

test('composed sign boards ride tool.set and trigger a replan when edited', () => {
  const initialBoards = {
    front: [{ id: 'c1', kind: 'text', text: 'A出口', x: 0.5, y: 0.2, scale: 1, side: 'both' }],
    back: [],
  }
  const updatedBoards = {
    front: [{ id: 'c1', kind: 'text', text: 'A出口', x: 0.5, y: 0.2, scale: 1, side: 'both' }],
    back: [{ id: 'c2', kind: 'text', text: 'B出口', x: 0.5, y: 0.2, scale: 1, side: 'both' }],
  }
  const { adapter, sent, set, notify } = setup(toolState({
    tool: 'module',
    moduleType: 'sign-ceiling',
    currentBoards: initialBoards,
  }))
  try {
    assert.equal(sent.length, 1)
    assert.equal(sent[0].settings.signBoards, JSON.stringify(initialBoards))
    set({ currentBoards: updatedBoards })
    notify()
    assert.equal(sent.length, 2, 'editing currentBoards pushes the new boards to Unity for preview & placement')
    assert.equal(sent[1].settings.signBoards, JSON.stringify(updatedBoards))
  } finally {
    adapter.dispose()
  }
})

test('adoptPickedModule copies pillarLength, slim spot, and piece settings synced by toolAdapter', () => {
  const before = useStore.getState()
  try {
    useStore.setState({ tool: 'pick', moduleType: 'gate', pillarLength: 5, moduleRot: 0, hangerLength: 4, roofWidth: 4, doorWide: false })
    const thick4m = { id: 'p-4', type: 'pillar', x: 1, y: 1, z: -5, rot: 0, cfg: { size: 'thick', height: 4 } }
    assert.equal(adoptPickedModule(thick4m, { select: false, notify: false }), true)
    let st = useStore.getState()
    assert.equal(st.tool, 'module')
    assert.equal(st.moduleType, 'pillar-thick')
    assert.equal(st.pillarLength, 4, 'picking a 4 m pillar must arm pillarLength=4 so it fits under a 4 m ceiling')
    assert.equal(settingsFor(st).pillarLength, 4)

    useStore.setState({ tool: 'pick', pillarLength: 5, moduleRot: 0 })
    const slim3m = { id: 'p-slim', type: 'pillar', x: 2, y: 2, z: 0, rot: 7, cfg: { size: 'slim', height: 3 } }
    assert.equal(adoptPickedModule(slim3m, { select: false, notify: false }), true)
    st = useStore.getState()
    assert.equal(st.moduleType, 'pillar-slim')
    assert.equal(st.pillarLength, 3)
    assert.equal(st.moduleRot, 7)

    useStore.setState({ tool: 'pick', hangerLength: 4, roofWidth: 4, doorWide: false, stairBlockHeight: 1 })
    assert.equal(adoptPickedModule({ id: 'h-8', type: 'hanger', x: 0, y: 0, z: 0, w: 8, rot: 1, cfg: { mount: 'roof' } }, { select: false, notify: false }), true)
    assert.equal(useStore.getState().hangerLength, 8)
    assert.equal(settingsFor(useStore.getState()).hangerLength, 8)

    useStore.setState({ tool: 'pick' })
    assert.equal(adoptPickedModule({ id: 'r-12', type: 'roof', x: 0, y: 0, z: 0, w: 4, d: 12, rot: 0, cfg: { variant: 'tapered-truss' } }, { select: false, notify: false }), true)
    assert.equal(useStore.getState().moduleType, 'roof-tapered')
    assert.equal(useStore.getState().roofWidth, 12)
  } finally {
    useStore.setState(before)
  }
})

test('parseHostPick parses module, face, custom hex, repeated seq, and empty host picks', () => {
  assert.deepEqual(parseHostPick(null), { kind: 'none', key: '' })
  assert.deepEqual(parseHostPick({ kind: 'none', moduleId: '', finish: '', seq: 1 }), { kind: 'none', key: '' })

  const face1 = parseHostPick({
    seq: 4,
    kind: 'face',
    moduleId: '',
    cell: [2, 3, 1],
    face: 's',
    finish: 'wall.enamel#ff4242',
    armable: true,
  })
  assert.deepEqual(face1, {
    kind: 'face',
    key: 'face|4|wall.enamel#ff4242|2,3,1|s',
    cell: [2, 3, 1],
    face: 's',
    finish: 'wall.enamel#ff4242',
  })

  const faceRepeat = parseHostPick({
    seq: 5,
    kind: 'face',
    moduleId: '',
    cell: [2, 3, 1],
    face: 's',
    finish: 'wall.enamel#ff4242',
    armable: true,
  })
  assert.notEqual(faceRepeat.key, face1.key, 'monotonic seq distinguishes repeated picks of the same face')

  const mod1 = parseHostPick({ seq: 6, kind: 'module', moduleId: 'bench-1', armable: true })
  const modRepeat = parseHostPick({ seq: 7, kind: 'module', moduleId: 'bench-1', armable: true })
  assert.equal(mod1.kind, 'module')
  assert.equal(mod1.moduleId, 'bench-1')
  assert.equal(mod1.armable, true)
  assert.notEqual(modRepeat.key, mod1.key, 'monotonic seq distinguishes repeated picks of the same module')

  const nonArmable = parseHostPick({ seq: 8, kind: 'module', moduleId: 'pe-1', armable: false })
  assert.equal(nonArmable.kind, 'module')
  assert.equal(nonArmable.armable, false)

  // Legacy payload without seq still produces a deterministic fallback key.
  const legacyFace = parseHostPick({ cell: [0, 1, 0], face: 'top', finish: 'floor.granite' })
  assert.equal(legacyFace.kind, 'face')
  assert.equal(legacyFace.key, 'face|floor.granite|0,1,0|top')
})

test('adoptPickedFace arms paint tool with stock/custom finish, keeps paintBaseMode, syncs settings, and restores on cancelPick', () => {
  const before = useStore.getState()
  try {
    // 1. Custom hex wall tint while paintBaseMode='surface'.
    useStore.setState({
      tool: 'pick',
      paintFinish: 'floor.concrete',
      paintMode: 'single',
      paintBaseMode: 'surface',
      pickDraft: null,
      notice: null,
    })
    adoptPickedFace([2, 3, 1], 'wall.enamel#ff4242', { select: false })
    let st = useStore.getState()
    assert.equal(st.tool, 'paint')
    assert.equal(st.paintFinish, 'wall.enamel#ff4242')
    assert.equal(st.paintMode, 'surface', 'adoptPickedFace preserves paintBaseMode')
    assert.equal(settingsFor(st).paintFinish, 'wall.enamel#ff4242', 'toolAdapter syncs custom hex finish to Unity')
    assert.equal(settingsFor(st).paintMode, 'surface')
    assert.ok(st.pickDraft, 'adoptPickedFace records pickDraft for Esc cancelPick')
    assert.ok(typeof st.notice === 'string' && st.notice.length > 0, 'adoptPickedFace shows localized picked finish notice')

    // Esc restores prior tool, finish, and paint mode.
    assert.equal(st.cancelPick(), true)
    st = useStore.getState()
    assert.equal(st.tool, 'pick')
    assert.equal(st.paintFinish, 'floor.concrete')
    assert.equal(st.paintMode, 'single')
    assert.equal(st.pickDraft, null)

    // 2. Bare default finish with paintBaseMode='single' and select=true selects the cell.
    useStore.setState({
      tool: 'pick',
      paintFinish: 'wall.tiles',
      paintMode: 'single',
      paintBaseMode: 'single',
      selected: null,
      pickDraft: null,
    })
    adoptPickedFace([4, 5, 0], 'floor.concrete', { select: true, notify: false })
    st = useStore.getState()
    assert.equal(st.tool, 'paint')
    assert.equal(st.paintFinish, 'floor.concrete')
    assert.equal(st.paintMode, 'single')
    assert.deepEqual(st.selected, { kind: 'cell', key: '4,5,0', label: '(4, 5, 0)' })
  } finally {
    useStore.setState(before)
  }
})
