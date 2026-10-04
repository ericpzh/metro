// The level slicing: 显示其他层, 隐藏天花板 and which storey a piece is drawn in.
//
// The rules live in `src/render/levelSlicing.ts` so they can be checked without
// a renderer. These are the regressions behind the bug they were extracted from:
// with 显示其他层 off, a side elevation still showed every storey (the floating
// plates above the active one), and a consist berthed at the level being edited
// disappeared.
import test from 'node:test'
import assert from 'node:assert/strict'
import { crowdVisible, levelSide, levelVisible, trainVisible, unsupportedAbove } from '../src/render/levelSlicing.ts'
import { storeyBand } from '../src/sim/constants.ts'

test('a piece is on the side of the storey it covers', () => {
  assert.equal(levelSide([0], 0), 'active')
  assert.equal(levelSide([-16], 0), 'below')
  assert.equal(levelSide([4], 0), 'above')
  assert.equal(levelSide(undefined, -8), 'active', 'an untagged piece (a decal) belongs to the active storey')
  assert.equal(levelSide([], -8), 'active')
})

test('a ramp or shaft that spans the active storey is in it, not beside it', () => {
  // A lift running -12 to -4 passes through -8: it is the lift in the room the
  // player is standing in, so it draws crisp rather than as a ghost.
  assert.equal(levelSide([-12, -4], -8), 'active')
  assert.equal(levelSide([-12, -4], -12), 'active')
  assert.equal(levelSide([-12, -4], -16), 'above')
  assert.equal(levelSide([-12, -4], 0), 'below')
})

test('显示其他层 off draws the active storey and nothing else, on any side', () => {
  const off = { ghost: false, autoCeiling: true }
  assert.equal(levelVisible('active', off), true)
  assert.equal(levelVisible('below', off), false)
  assert.equal(levelVisible('above', off), false)
  // 隐藏天花板 is a setting *about* the storey above: with the other storeys off
  // there is nothing left for it to hide, so it cannot re-open the cut.
  assert.equal(levelVisible('above', { ghost: false, autoCeiling: false, unsupported: true }), false)
  assert.equal(levelVisible('below', { ghost: false, autoCeiling: false }), false)
})

test('显示其他层 on ghosts the neighbours and keeps every unsupported plate', () => {
  const on = { ghost: true, autoCeiling: true }
  assert.equal(levelVisible('active', on), true)
  assert.equal(levelVisible('below', on), true, 'a lower storey shows whenever the toggle is on')
  // Above the active storey, only a plate with nothing under it survives: the
  // street outside is not the room's ceiling.
  assert.equal(levelVisible('above', { ...on, unsupported: false }), false)
  assert.equal(levelVisible('above', { ...on, unsupported: true }), true)
})

test('隐藏天花板 off draws the ceiling of the storey above as well', () => {
  const noHide = { ghost: true, autoCeiling: false }
  assert.equal(levelVisible('above', { ...noHide, unsupported: false }), true)
  assert.equal(levelVisible('above', { ...noHide, unsupported: true }), true)
})

test('a fixture above the active storey is unsupported when its column starts there', () => {
  // The column reaches the active storey, so the fixture is that room's ceiling.
  assert.equal(unsupportedAbove(-4, -4), false)
  assert.equal(unsupportedAbove(-4, -8), false, 'a column reaching below is grounded under it')
  // The column starts above the active storey: the fixture stands on a plate
  // hanging in space, so 隐藏天花板 keeps it.
  assert.equal(unsupportedAbove(-4, 0), true)
  assert.equal(unsupportedAbove(-4, undefined), false, 'an untagged fixture is never "hanging"')
})

test('a consist is drawn in the storey it stands in, never one up', () => {
  // The train rides half a metre under the platform, so its band comes from the
  // floor block it stands on — the bug was `z - 1` un-rounded, which banded a
  // -16 consist to -16.5 (below the level being edited) and hid it.
  assert.equal(storeyBand(Math.round(-15.5 - 1)), -16)
  assert.equal(levelSide([storeyBand(Math.round(-15.5 - 1))], -16), 'active')
  assert.equal(levelSide([storeyBand(Math.round(-15.5 - 1))], 0), 'below')

  assert.equal(trainVisible('active', false, false), true, 'the train at the platform you are editing shows')
  assert.equal(trainVisible('active', false, true), false, 'a parked consist never shows')
  assert.equal(trainVisible('below', true, false), true)
  assert.equal(trainVisible('below', false, false), false)
  assert.equal(trainVisible('above', true, false), false, 'its floor is not drawn up there, so it would float')
})

test('the crowd follows the same storeys as the floor under it', () => {
  assert.equal(crowdVisible(-15, -16, false), true, 'the platform crowd is on the storey you are editing')
  assert.equal(crowdVisible(-15, 0, false), false)
  assert.equal(crowdVisible(-15, 0, true), true)
  assert.equal(crowdVisible(1, -16, true), false, 'a storey above never shows its crowd')
  assert.equal(crowdVisible(-7, -4, false), false, 'the -8 storey is below -4, so it needs the toggle')
  assert.equal(crowdVisible(-7, -4, true), true)
  assert.equal(crowdVisible(1, -4, true), false, 'the 0 storey is above -4: never its crowd')
})
