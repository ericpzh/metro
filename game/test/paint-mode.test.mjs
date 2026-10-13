// The 材质 brush setting (GAME-SPEC §4.3): each material submenu offers 单块 / 整面,
// Tab cycles them, and `I` 取色 only borrows the active mode. Choosing a texture — a plain finish tile or
// the 搪瓷板 colour picker — must not reset the mode, so the setting a player left
// the folder in is still there after a detour through another folder on the left
// rail; and eyedropping a face hands the brush back in the mode it was entered
// with instead of dropping it to 单块.
//
// The rail's tiles only call these store commands, so this covers the click.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { useStore } from '../src/app/store.ts'
import { customFinishId, finishBaseId, finishDef, finishTint } from '../src/sim/finishes.ts'
import { customPaintColoursInStation } from '../src/app/rail/paintColours.ts'

const paintFolder = readFileSync(new URL('../src/app/rail/folders/PaintFolder.tsx', import.meta.url), 'utf8')
const colourTiles = readFileSync(new URL('../src/app/rail/shared/ColourTile.tsx', import.meta.url), 'utf8')
const paintCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const appShell = readFileSync(new URL('../src/app/windows/AppShell.tsx', import.meta.url), 'utf8')

const st = () => useStore.getState()

// Every case starts from a cold rail: 工具 选择, 材质 单块 on 花岗岩.
test.beforeEach(() => {
  useStore.setState({
    tool: 'select',
    paintMode: 'single',
    paintBaseMode: 'single',
    paintFinish: 'floor.granite',
    enamelColour: finishDef('wall.enamel').tint,
    plasterColour: finishDef('wall.plaster').tint,
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

test('涂料 remembers its own colour and keeps the surface brush mode', () => {
  st().setPaintMode('surface')
  st().setEnamelColour(0x1188ee)
  st().setPlasterColour(0xff8800)
  st().selectPaintFinish(customFinishId('wall.plaster', st().plasterColour))
  assert.equal(st().paintMode, 'surface')
  assert.equal(finishBaseId(st().paintFinish), 'wall.plaster')
  assert.equal(finishTint(st().paintFinish), 0xff8800)
  assert.equal(st().enamelColour, 0x1188ee, 'paint and enamel keep independent colours')
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

test('saved custom colors are collected from the station and omit stock swatches', () => {
  const station = {
    cells: [
      { finish: { n: 'wall.enamel#f72b2b', top: 'wall.enamel#f72b2b' } },
      { finish: { e: 'wall.enamel#2f7ef2', s: 'wall.plaster#abcdef' } },
    ],
    modules: [
      { cfg: { finish: 'wall.enamel#ff4242' } },
      { cfg: { bridgeFinish: 'wall.enamel#f94848' } },
      { cfg: { finish: 'wall.plaster#123456' } },
    ],
  }
  assert.deepEqual(customPaintColoursInStation(station, 'wall.enamel'), [0xf72b2b, 0xf94848, 0xff4242])
  assert.deepEqual(customPaintColoursInStation(station, 'wall.plaster'), [0x123456, 0xabcdef])
})

test('each material owns a two-mode submenu, with Tab cycling and no current-color tile row', () => {
  const panelAt = paintFolder.indexOf('<InlinePanel key=')
  const gridAt = paintFolder.indexOf('<div className="blockGrid">', panelAt)
  const gridEnd = paintFolder.indexOf('</div>', gridAt)
  const modeGrid = paintFolder.slice(gridAt, gridEnd)
  assert.match(paintFolder, /const menu = `paint:\$\{anchor\}`/)
  assert.match(modeGrid, /id: 'single'/)
  assert.match(modeGrid, /id: 'surface'/)
  assert.doesNotMatch(modeGrid, /ColourTile|NewColorTile/)
  assert.match(paintFolder, /shortcut="Tab"/)
  assert.match(appShell, /if \(st\.tool === 'paint'\) st\.setPaintMode\(st\.paintMode === 'single' \? 'surface' : 'single'\)/)
})

test('used-color tiles and New Color open native color pickers in the two-column palette', () => {
  assert.match(paintFolder, /colours\.map\(\(colour\) => \(\s*<ColourTile key=\{colour\}/)
  assert.match(paintFolder, /<NewColorTile colour=\{colourFor\(anchor\)\}/)
  assert.doesNotMatch(paintFolder, /blockGrid three/)
  assert.match(colourTiles, /export function ColourTile[\s\S]*?className="bpColour"[\s\S]*?type="color"/)
  assert.match(colourTiles, /export function NewColorTile[\s\S]*?className="bpNewColourInput"[\s\S]*?type="color"/)
  assert.match(paintCss, /\.bpNewColourPlus\s*\{[^}]*color:\s*#fff/i)
  assert.match(paintCss, /\.bpNewColourTile \.bpBlockLabel\s*\{[^}]*color:\s*#fff/i)
})
