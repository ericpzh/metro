import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore } from '../src/app/store.ts'
import { placementPreviewKey } from '../src/app/store/catalog.ts'
import { EquipmentTool } from '../src/app/tools/EquipmentTool.ts'
import { moduleGhostKey } from '../src/render/moduleGhostKey.ts'

test('door width cycles through previews and applies to steel and wood placement', () => {
  const before = useStore.getState()
  try {
    const tool = new EquipmentTool({})
    useStore.setState({ moduleType: 'door-steel-1', doorWide: false, moduleRot: 0 })
    const narrowKey = placementPreviewKey(useStore.getState())
    const narrow = tool.buildPlacementModules('door-steel-1', [4, 5, 0], 'preview')[0]
    assert.equal(narrow.w, 1)
    useStore.getState().toggleDoorWidth()
    assert.equal(useStore.getState().doorWide, true)
    assert.notEqual(placementPreviewKey(useStore.getState()), narrowKey, 'width change invalidates the app preview cache')
    const wideSteel = tool.buildPlacementModules('door-steel-1', [4, 5, 0], 'preview')[0]
    const wideWood = tool.buildPlacementModules('door-wood-1', [4, 5, 0], 'preview')[0]
    assert.equal(wideSteel.w, 2)
    assert.equal(wideSteel.cfg.variant, 'steel-2')
    assert.equal(wideWood.w, 2)
    assert.equal(wideWood.cfg.variant, 'wood-2')
    assert.notEqual(moduleGhostKey(narrow), moduleGhostKey(wideSteel), 'width change refreshes the ghost')
    assert.equal(wideSteel.x, 4, 'widening keeps the module anchored on the hovered cell')
  } finally {
    useStore.setState(before)
  }
})

test('hanger length cycles 4/6/8 metres and each preview follows the setting', () => {
  const before = useStore.getState()
  try {
    const tool = new EquipmentTool({})
    useStore.setState({ moduleType: 'hanger-roof', hangerLength: 4, moduleRot: 0 })
    const keys = []
    const cacheKeys = []
    for (const length of [4, 6, 8, 4]) {
      assert.equal(useStore.getState().hangerLength, length)
      cacheKeys.push(placementPreviewKey(useStore.getState()))
      const hanger = tool.buildPlacementModules('hanger-roof', [4, 5, 0], 'preview')[0]
      assert.equal(hanger.w, length)
      keys.push(moduleGhostKey(hanger))
      useStore.getState().cycleHangerLength()
    }
    assert.notEqual(keys[0], keys[1])
    assert.notEqual(keys[1], keys[2])
    assert.equal(keys[0], keys[3], 'cycling back restores the original preview')
    assert.notEqual(cacheKeys[0], cacheKeys[1], 'length change invalidates the app preview cache')
    assert.equal(cacheKeys[0], cacheKeys[3], 'cycling back restores the original cache key')
  } finally {
    useStore.setState(before)
  }
})
