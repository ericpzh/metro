// The two folder ladders (`app/rail/helpers.ts`): **Shift+Q** opens the build rail's
// first folder, the 工具 folder, and W E R T Y U follow the folders below it — while the
// 信息栏's stack answers to **Alt+Q, Alt+W, Alt+E, Alt+R** (信息, 视图, 出入口, 线路).
//
// One column, one table, one modifier: `RAIL_FOLDERS` is the rail's stack and
// `folderForShiftKey` reads it; `INSPECTOR_FOLDERS` is the inspector's and
// `folderForAltKey` reads that. Both halves are pinned here — the columns stack their
// folders in table order and print each key on the header, and the app's one keydown
// listener turns a modified letter into the folder it names, wherever that folder lives.
//
// **视图's own body is pinned here too**, because it is the one folder whose *shape* is a
// decision rather than data: its eight tiles in reading order — the three modes, the three
// surfaces taken away, the two overlays — with 剖切's folded-out row at the foot of the row
// 剖切 sits in, the header's count matching the tiles, and the folder opening with the app.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { INSPECTOR_FOLDERS, RAIL_FOLDERS, folderForAltKey, folderForShiftKey } from '../src/app/rail/helpers.ts'

test('the rail is Shift+Q W E R T Y U, one letter a row down the stack', () => {
  assert.deepEqual(
    RAIL_FOLDERS.map((f) => f.shift),
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U'],
  )
  assert.deepEqual(RAIL_FOLDERS[0], { key: 'tools', title: '工具', shift: 'Q' }, 'Shift+Q is the 工具 folder, the one already open')
  assert.equal(RAIL_FOLDERS[1].key, 'rail', 'and Shift+W the 轨道 folder under it')
  assert.equal(RAIL_FOLDERS.at(-1).key, 'zones', '分区 ends the column')
})

test('材质 sits directly above 房间, and every other folder keeps its place', () => {
  const keys = RAIL_FOLDERS.map((f) => f.key)
  assert.equal(keys.indexOf('rooms') - keys.indexOf('surfaces'), 1, '材质 is the row above 房间')
  assert.deepEqual(keys, ['tools', 'rail', 'equipment', 'decor', 'surfaces', 'rooms', 'zones'])
})

test('the 信息栏 is Alt+Q W E R over its own four folders, in stack order', () => {
  assert.deepEqual(
    INSPECTOR_FOLDERS.map((f) => f.alt),
    ['Q', 'W', 'E', 'R'],
  )
  assert.deepEqual(
    INSPECTOR_FOLDERS.map((f) => f.key),
    ['info', 'view', 'exits', 'lines'],
    '信息 / 视图 / 出入口 / 线路, top to bottom',
  )
  assert.deepEqual(INSPECTOR_FOLDERS[1], { key: 'view', title: '视图', alt: 'W' }, '视图 is the second row, on Alt+W')
  // Alt+T is the next slot on the ladder — no folder stands there yet.
  assert.equal(folderForAltKey('t'), null)
})

test('a folder stands on one key and a key on one folder, within its own column', () => {
  // A rail folder and an inspector folder may share a **letter**: they carry different
  // modifiers (Shift vs Alt), which is the whole point of the split.
  const railShifts = RAIL_FOLDERS.map((f) => f.shift)
  const inspectorAlts = INSPECTOR_FOLDERS.map((f) => f.alt)
  assert.equal(new Set(railShifts).size, railShifts.length, 'two rail folders on one Shift+letter would fight over it')
  assert.equal(new Set(inspectorAlts).size, inspectorAlts.length, 'and two inspector folders on one Alt+letter')
  assert.ok(railShifts.some((s) => inspectorAlts.includes(s)), 'the two columns do share letters — Q, W, E and R')
  // Within a column a **folder** stands on one key, and nothing is listed twice: a key
  // held by two rows would fold two headers in that column at once.
  for (const rows of [RAIL_FOLDERS, INSPECTOR_FOLDERS]) {
    const keys = rows.map((f) => f.key)
    assert.equal(new Set(keys).size, keys.length, 'a folder listed twice would fold two headers at once')
  }
  // 视图 is the folder that moved between the columns, and it is in **one** table: a row
  // left behind on the rail's would fold a header in the other column with Alt+W.
  assert.equal(RAIL_FOLDERS.some((f) => f.key === 'view'), false, '视图 is no longer a rail folder')
})

test('a modified letter resolves to its own column and nothing else does', () => {
  // The listener hands over `KeyboardEvent.key.toLowerCase()`, so both lookups are
  // case-blind: a Shift+Q arrives as 'q', an Alt+Q as 'q' as well.
  assert.equal(folderForShiftKey('q'), 'tools')
  assert.equal(folderForShiftKey('Q'), 'tools')
  assert.equal(folderForShiftKey('t'), 'surfaces', '材质 moved up, and its letter moved with its row')
  assert.equal(folderForShiftKey('y'), 'rooms')
  assert.equal(folderForShiftKey('u'), 'zones')
  // 视图 left the rail, so nothing on the rail stands on I any more — Shift+I falls
  // through to the app's own switch, as any unused letter does.
  assert.equal(folderForShiftKey('i'), null)

  assert.equal(folderForAltKey('q'), 'info', 'Alt+Q is the 信息栏’s first row')
  assert.equal(folderForAltKey('Q'), 'info')
  assert.equal(folderForAltKey('w'), 'view')
  assert.equal(folderForAltKey('e'), 'exits')
  assert.equal(folderForAltKey('r'), 'lines')
  // Neither lookup answers for the other column: the modifier is what tells them apart.
  assert.equal(folderForAltKey('y'), null, 'Alt+Y names no 信息栏 folder')
  assert.equal(folderForShiftKey('i'), null)
  assert.equal(folderForAltKey('o'), null)
  assert.equal(folderForShiftKey('o'), null, 'O is the next slot on the rail ladder, and empty')
  assert.equal(folderForAltKey('b'), null, 'a letter the ladder does not use hands the key back')
  assert.equal(folderForAltKey('alt'), null, 'the modifier alone is not a folder')
  assert.equal(folderForShiftKey(''), null)
  assert.equal(folderForAltKey(''), null)
})

/* ------------------------------------------------------------- 视图's own shape */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 视图's tile grid, as the JSX in that one block reads — labels in render order. */
function viewTiles() {
  const src = read('../src/app/rail/folders/ViewFolder.tsx')
  const open = src.indexOf('<div className="blockGrid">')
  assert.ok(open > 0, 'ViewFolder renders no blockGrid')
  const grid = src.slice(open, src.indexOf('</div>', open))
  return {
    grid,
    labels: [...grid.matchAll(/label="([^"]+)"/g)].map((m) => m[1]),
  }
}

test('视图 draws eight tiles, in the folder’s reading order', () => {
  const { labels } = viewTiles()
  // Three rows of the 3-wide grid: the modes that decide how the station is drawn, the
  // surfaces taken away under them, and the overlays that paint the station.
  assert.deepEqual(
    labels,
    ['显示其他层', '剖切', '隐藏UI', '隐藏天花板', '隐藏墙壁', '隐藏地面', '分区图', '热力图'],
    'the 视图 folder’s tiles moved',
  )
  // The header's count is the tiles the folder can show — the one number that would
  // quietly disagree with the grid, so it is derived from it here rather than repeated.
  const inspector = read('../src/app/windows/inspector/Inspector.tsx')
  const count = inspector.match(/view:\s*\{\s*count:\s*(\d+)/)
  assert.ok(count, 'the inspector no longer counts 视图’s tiles')
  assert.equal(Number(count[1]), labels.length, '视图’s header count disagrees with the tiles it draws')
})

test('剖切’s folded-out row is at the foot of the row 剖切 sits in', () => {
  // A folded-out row spans the grid and can only be inserted **between** rows: placed
  // beside the tile it belongs to, it would break the row after two tiles and leave the
  // third cell of the 3-wide grid empty (`ViewFolder.tsx`'s note on `<CutControls>`).
  const { grid } = viewTiles()
  const cut = grid.indexOf('<CutControls')
  assert.ok(cut > 0, '剖切 folds nothing out')
  assert.ok(cut > grid.indexOf('label="隐藏UI"'), 'the cut row is inside the first row rather than after it')
  assert.ok(cut < grid.indexOf('label="隐藏天花板"'), 'the cut row broke the row after it')
  // The row itself is the cut's own two controls, 旋转 wearing the angle it turns to.
  const src = read('../src/app/rail/folders/ViewFolder.tsx')
  assert.ok(src.includes('label="隐藏剖切面"'), '隐藏剖切面 left the cut row')
  assert.ok(/RotateTile label=\{`旋转 \$\{next\}°`\}/.test(src), 'the cut row lost its 旋转 tile')
})

test('视图 opens with the app, like every other row of the 信息栏', () => {
  const inspector = read('../src/app/windows/inspector/Inspector.tsx')
  const seed = inspector.match(/useState<Record<InspectorFolderKey, boolean>>\(\{([\s\S]*?)\}\)/)
  assert.ok(seed, 'the inspector no longer seeds its folders')
  const open = Object.fromEntries([...seed[1].matchAll(/(\w+):\s*(true|false)/g)].map((m) => [m[1], m[2] === 'true']))
  assert.deepEqual(Object.keys(open), ['info', 'view', 'exits', 'lines'], 'the seeded rows are not the column’s folders')
  assert.equal(open.view, true, '视图 starts folded again')
  assert.ok(
    Object.values(open).every(Boolean),
    'a row of the 信息栏 starts folded: every one of them is a read-out the player opened the panel for',
  )
})
