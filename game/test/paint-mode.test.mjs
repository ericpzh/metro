// The 材质 folder's own setting (GAME-SPEC §4.3): `N` 单块 and click-only 整面 are the
// brush, and `I` 取色 only borrows it. Choosing a texture — a plain finish tile or
// the 搪瓷板 colour picker — must not reset the mode, so the setting a player left
// the folder in is still there after a detour through another folder on the left
// rail; and eyedropping a face hands the brush back in the mode it was entered
// with instead of dropping it to 单块.
//
// The rail's tiles only call these store commands, so this covers the click.
import test from 'node:test'
import assert from 'node:assert/strict'
import { useStore } from '../src/app/store.ts'
import { customFinishId, finishBaseId, finishDef, finishTint } from '../src/sim/finishes.ts'

const st = () => useStore.getState()

// Every case starts from a cold rail: 工具 选择, 材质 单块 on 花岗岩.
test.beforeEach(() => {
  useStore.setState({
    tool: 'select',
    paintMode: 'single',
    paintBaseMode: 'single',
    paintFinish: 'floor.granite',
    enamelColour: finishDef('wall.enamel').tint,
    moduleType: 'gate',
  })
})

test('a finish tile keeps the 单块 / 整面 mode', () => {
  st().setPaintMode('surface')
  st().selectPaintFinish('floor.concrete')
  assert.equal(st().paintFinish, 'floor.concrete')
  assert.equal(st().tool, 'paint')
  assert.equal(st().paintMode, 'surface', 'choosing a texture reset the mode')

  st().setPaintMode('single')
  st().selectPaintFinish('wall.tile')
  assert.equal(st().paintMode, 'single')
})

test('the mode survives a detour through another folder on the rail', () => {
  // 材质: 整面 on 花岗岩 …
  st().setPaintMode('surface')
  st().selectPaintFinish('floor.granite')
  // … 设备: pick a 闸机, which flips the shared tool like the rail's tile does …
  st().setModuleType('gate')
  st().setTool('module')
  assert.equal(st().paintMode, 'surface', 'leaving the folder must not change the brush')
  // … back to 材质 for a different texture: the folder's last setting stands.
  st().selectPaintFinish('floor.tile')
  assert.equal(st().paintMode, 'surface')
  assert.equal(st().tool, 'paint')
})

test('a fresh 搪瓷板 colour keeps the mode and reaches the brush', () => {
  st().setPaintMode('surface')
  st().setEnamelColour(0xff8800)
  st().selectPaintFinish(customFinishId('wall.enamel', 0xff8800))
  assert.equal(st().paintMode, 'surface')
  assert.equal(finishBaseId(st().paintFinish), 'wall.enamel')
  assert.equal(finishTint(st().paintFinish), 0xff8800, 'the brush must carry the picked colour, not the previous one')
})

test('取色 borrows the brush and hands it back in the mode it was entered with', () => {
  st().setPaintMode('surface')
  st().setPaintMode('pick')
  assert.equal(st().paintMode, 'pick')
  assert.equal(st().paintBaseMode, 'surface', '取色 must not become the mode the brush returns to')
  st().resumePaintMode()
  assert.equal(st().paintMode, 'surface')

  st().setPaintMode('single')
  st().setPaintMode('pick')
  st().resumePaintMode()
  assert.equal(st().paintMode, 'single')

  // Clicking a texture while 取色 is armed leaves the eyedropper, too.
  st().setPaintMode('surface')
  st().setPaintMode('pick')
  st().selectPaintFinish('wall.tile')
  assert.equal(st().paintMode, 'surface')
})
