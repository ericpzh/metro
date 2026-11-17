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
