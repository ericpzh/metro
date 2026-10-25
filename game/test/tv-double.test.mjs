import test from 'node:test'
import assert from 'node:assert/strict'

import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { familyFor, familyOptions } from '../src/app/store/catalog.ts'
import { useStore } from '../src/app/store.ts'
import { toState } from '../src/build/model.ts'
import { tvPairSlot } from '../src/sim/tvs.ts'

test('the TV family offers single-sided and double-sided palette choices', () => {
  const family = familyFor('tv')
  assert.ok(family)
  assert.equal(family.key, 'tv')
  assert.deepEqual(familyOptions(family).map(({ id }) => id), ['tv', 'tv-double'])
})

test('double-sided TV previews and places an opposite-facing pair in one commit', () => {
  const before = useStore.getState()
  try {
    const station = toState({
      name: 'double-sided TV',
      seed: 1,
      cells: [
        { x: 0, y: 0, z: 0, fill: 'solid' },
        { x: 0, y: 0, z: 4, fill: 'solid' },
      ],
      modules: [],
      lines: [],
    })
    useStore.setState({ station, past: [], future: [], tool: 'module', moduleType: 'tv-double', moduleRot: 1, selected: null })

    let preview = null
    let refused = true
    const scene = {
      setModulePreview(modules, blocked) { preview = modules; refused = blocked },
      setCursor() {},
      setCollisionHighlight() {},
      setFencePreview() {},
      setGhost() {},
    }
    const tool = new EquipmentTool({ scene: () => scene, hover: { current: null }, drag: { current: null } })
    const pointer = {
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 1,
      hit: { cell: [0, 0, 0], place: [0, 0, 0], solid: true, point: [0.5, 0.5, 1], normal: [0, 0, 1] },
      preventDefault() {},
    }

    tool.onMove(pointer)
    assert.equal(refused, false)
    assert.equal(preview.length, 2)
    assert.equal(new Set(preview.map(({ x, y, z }) => `${x},${y},${z}`)).size, 1, 'both screens share the snapped ceiling anchor')
    assert.deepEqual(preview.map(({ rot }) => rot).sort(), [1, 3])

    tool.onDown(pointer)
    const placed = useStore.getState().station.modules.filter((module) => module.type === 'tv')
    assert.equal(placed.length, 2)
    assert.deepEqual(placed.map(({ rot }) => rot).sort(), [1, 3])
    assert.equal(useStore.getState().past.length, 1, 'both screens are one undoable placement')
    assert.equal(placed.filter((module) => tvPairSlot(module.id, placed).hangs).length, 1)
  } finally {
    useStore.setState(before)
  }
})
