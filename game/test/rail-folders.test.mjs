// The rail's folder ladder (`app/rail/helpers.ts`): **Shift+Q** opens the first
// folder, the 工具 folder, and W E R T Y U I follow the folders below it.
//
// The ladder is one list read two ways — the shell stacks the folders in this
// order and prints each key on its header, the app's one keydown listener turns a
// Shift+letter into the folder it names — so the order, the letters and the
// hand-off are pinned here rather than trusted to either half.
import test from 'node:test'
import assert from 'node:assert/strict'
import { RAIL_FOLDERS, folderForShiftKey } from '../src/app/rail/helpers.ts'

test('the ladder is Q W E R T Y U I, a folder a letter, top of the rail first', () => {
  assert.deepEqual(
    RAIL_FOLDERS.map((f) => f.shift),
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I'],
  )
  assert.deepEqual(RAIL_FOLDERS[0], { key: 'tools', title: '工具', shift: 'Q' }, 'Shift+Q is the 工具 folder, the one already open')
  assert.equal(RAIL_FOLDERS[1].key, 'rail', 'and Shift+W the 轨道 folder under it')
  assert.equal(RAIL_FOLDERS.at(-1).key, 'view')
})

test('every folder stands on exactly one key, and no key on two folders', () => {
  const keys = RAIL_FOLDERS.map((f) => f.key)
  const shifts = RAIL_FOLDERS.map((f) => f.shift)
  assert.equal(new Set(keys).size, keys.length, 'a folder listed twice would fold two headers at once')
  assert.equal(new Set(shifts).size, shifts.length, 'two folders on one key would fight over it')
})

test('a Shift+letter resolves to its folder, and nothing else does', () => {
  // The listener hands over `KeyboardEvent.key.toLowerCase()`, so the lookup is
  // case-blind: a Shift+Q arrives as 'q'.
  assert.equal(folderForShiftKey('q'), 'tools')
  assert.equal(folderForShiftKey('Q'), 'tools')
  assert.equal(folderForShiftKey('i'), 'view')
  // O is the tenth slot on the ladder: no folder stands there yet, so the key
  // falls through to the switch (`o` toggles 正交) rather than folding anything.
  assert.equal(folderForShiftKey('o'), null)
  assert.equal(folderForShiftKey('b'), null, 'a letter the rail does not use hands the key back')
  assert.equal(folderForShiftKey('shift'), null, 'the modifier alone is not a folder')
  assert.equal(folderForShiftKey(''), null)
})
