// The 剖切 section's own arithmetic (`src/render/section.ts`).
//
// The cut is a placed surface: a location along its normal and a quarter-turn
// look. Four things have to agree on it — the clip plane three.js slices with,
// the highlighted surface drawn on it, the ray that snaps the pointer onto it
// and the drag that slides it — so this is where the definitions are pinned:
// which way a fresh cut looks, which half it keeps, what "+0.5 m" does, and how
// a pointer position turns into a slide.
//
// The look is a **quarter turn** (0 / 90 / 180 / 270): the 旋转 tile steps it,
// and the cut is never tilted out of the vertical, so the drag runs along a
// horizontal normal at every one of the four.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SECTION_AZIMUTH,
  QUARTER_TURNS,
  SECTION_SNAP,
  SECTION_SNAP_FINE,
  dragOffset,
  nextAzimuth,
  planeConstant,
  sectionHighlightSize,
  sectionNormal,
  sectionPoint,
  sectionRight,
  sectionUp,
  slideOffset,
  snapOffset,
  walkAlong,
} from '../src/render/section.ts'

const orient = (azimuth) => ({ azimuth })
const section = (azimuth, offset, anchor = [0, 0, 0]) => ({ anchor, orientation: orient(azimuth), offset })
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test('a fresh cut looks north, exactly: +y at the default', () => {
  assert.equal(DEFAULT_SECTION_AZIMUTH, 0)
  const n = sectionNormal(orient(0))
  assert.deepEqual([...n].map((v) => Number(v.toFixed(12))), [0, 1, 0], 'the old fixed plane faced +y, and so does the new default')
  assert.ok(close(Math.hypot(...n), 1), 'the normal is a unit vector')
})

test('the look is one of four quarter turns, and stays horizontal', () => {
  const north = sectionNormal(orient(0))
  assert.ok(close(north[1], 1) && close(north[0], 0), '0° looks north (+y)')
  const east = sectionNormal(orient(90))
  assert.ok(close(east[0], 1) && close(east[1], 0), '90° looks east (+x)')
  const south = sectionNormal(orient(180))
  assert.ok(close(south[1], -1) && close(south[0], 0), '180° looks south (−y)')
  const west = sectionNormal(orient(270))
  assert.ok(close(west[0], -1) && close(west[1], 0), '270° looks west (−x)')
  for (const turn of QUARTER_TURNS) {
    const n = sectionNormal(orient(turn))
    assert.ok(close(Math.hypot(...n), 1), `a unit vector at ${turn}°`)
    assert.ok(close(n[2], 0), `never tilted out of the vertical at ${turn}°`)
  }
})

test('旋转 steps one quarter turn and wraps at 270', () => {
  assert.deepEqual([...QUARTER_TURNS], [0, 90, 180, 270])
  assert.equal(nextAzimuth(0), 90)
  assert.equal(nextAzimuth(90), 180)
  assert.equal(nextAzimuth(180), 270)
  assert.equal(nextAzimuth(270), 0, 'the fourth press is back where it started')
  // Four presses return the look, whatever it started on.
  let az = 0
  for (let i = 0; i < 4; i++) az = nextAzimuth(az)
  assert.equal(az, 0)
  // A section saved off the grid (an older document) lands back on it.
  assert.equal(nextAzimuth(37), 90)
  assert.equal(nextAzimuth(-10), 90)
})

test('the surface frame is orthonormal at every quarter turn', () => {
  for (const az of QUARTER_TURNS) {
    const n = sectionNormal(orient(az))
    const right = sectionRight(n)
    const up = sectionUp(n, right)
    assert.ok(close(Math.hypot(...right), 1), `right is unit at ${az}°`)
    assert.ok(close(Math.hypot(...up), 1), `up is unit at ${az}°`)
    assert.ok(close(dot(n, right), 0), `right ⟂ normal at ${az}°`)
    assert.ok(close(dot(n, up), 0), `up ⟂ normal at ${az}°`)
    assert.ok(close(dot(right, up), 0), `right ⟂ up at ${az}°`)
    assert.ok(close(up[2], 1), `up is straight up at ${az}°, so the sheet stands vertical`)
  }
})

test('offset slides the cut the way the surface faces, and nowhere else', () => {
  const s = section(0, 0, [2, 3, -8])
  assert.deepEqual(sectionPoint(s), [2, 3, -8])
  assert.deepEqual(sectionPoint({ ...s, offset: 1.5 }), [2, 4.5, -8], 'a cut looking north walks north')
  const east = section(90, 2, [0, 0, -8])
  assert.ok(close(sectionPoint(east)[0], 2), 'a cut looking east walks east')
  assert.ok(close(sectionPoint(east)[1], 0) && close(sectionPoint(east)[2], -8), 'and not sideways or in z')
})

test('the plane keeps the half behind it: what the surface faces is cut away', () => {
  // three.js keeps `dot(normal, p) + constant >= 0`, with `constant` written as
  // `+d`, so the kept half is `dot(normal, p) - d >= 0` — everything on the far
  // side of the cut. A cut at y = 3 looking north keeps y ≥ 3: the *northern*
  // half, the one the camera standing south of the cut can see.
  assert.ok(close(planeConstant(section(0, 0, [0, 3, 0])), 3))
  const inside = (s, p) => dot(sectionNormal(s.orientation), p) - planeConstant(s) >= 0
  const s = section(0, 0, [0, 3, 0])
  assert.equal(inside(s, [5, 4, 5]), true, 'the half behind the cut survives')
  assert.equal(inside(s, [5, 2, 5]), false, 'the half the surface has not reached is cut away')
  assert.equal(inside(s, [5, 3, 5]), true, 'the plane itself is inside, so the surface is not clipped off')
  // The constant is the distance from the world origin to the cut along the
  // normal, so it grows as the cut walks the way it looks.
  assert.ok(close(planeConstant({ ...s, offset: 1 }), 4))
  // A cut looking west keeps everything west of it: the same rule, other way.
  const west = section(270, 0, [4, 0, 0])
  assert.equal(inside(west, [-1, 0, 0]), true, 'past the cut in the way it looks survives')
  assert.equal(inside(west, [9, 0, 0]), false, 'and what it has not reached is cut away')
})

test('snapping lands the cut on a round number of blocks', () => {
  assert.equal(SECTION_SNAP, 0.5)
  assert.equal(SECTION_SNAP_FINE, 0.05)
  assert.equal(snapOffset(0.31), 0.5)
  assert.equal(snapOffset(0.24), 0)
  assert.equal(snapOffset(-1.26), -1.5)
  assert.ok(close(snapOffset(0.31, true), 0.3), 'the fine step is 5 cm, to float precision')
  assert.ok(close(snapOffset(-1.234, true), -1.25))
  assert.equal(snapOffset(2), 2, 'a value already on the grid is left alone')
})

test('a drag follows the pointer along the normal only, at every quarter turn', () => {
  const point = [0, 0, 0]
  // The projection every drag step lands on: slide by the pointer's travel in
  // **world** space. Straight along +y: the cut walks the whole way.
  assert.ok(close(slideOffset(0, point, [0, 2, 0], orient(0)), 2))
  // Sideways: the projection is zero, so the cut does not move at all.
  assert.ok(close(slideOffset(0, point, [7, 0, -3], orient(0)), 0))
  // Diagonal: only the normal component counts.
  assert.ok(close(slideOffset(0, point, [7, 2, -3], orient(0)), 2))
  // It is a *relative* slide: where the cut already is does not change the step.
  assert.ok(close(slideOffset(4, point, [0, 1, 0], orient(0)), 5))
  // Turned: the axis the drag reads moves with the look, which is the whole
  // point of the tile — the cut only ever shifts along the direction of (R).
  assert.ok(close(slideOffset(0, point, [3, 0, 0], orient(90)), 3), 'looking east, an eastward drag walks the cut')
  assert.ok(close(slideOffset(0, point, [0, 3, 0], orient(90)), 0), 'and a northward one moves it nowhere')
  assert.ok(close(slideOffset(0, point, [-3, 0, 0], orient(270)), 3), 'looking west, a westward drag walks it')
  assert.ok(close(slideOffset(0, point, [0, -3, 0], orient(180)), 3), 'looking south, a southward drag walks it')
  // The drag never lifts the cut out of the vertical, at any turn.
  for (const az of QUARTER_TURNS) {
    assert.ok(close(slideOffset(0, point, [0, 0, -5], orient(az)), 0), `a vertical drag moves the cut nowhere at ${az}°`)
  }
})

test('a drag moves the cut only the way the look points, on screen', () => {
  // What the viewport does with a pointer move: the travel is measured along the
  // cut's own axis as it appears on screen, and converted to metres
  // (`dragOffset` / `walkAlong`, `SceneRenderer.sectionDragAxis`). The axis is
  // what makes this a slide and not a nudge: a step across it counts for nothing,
  // so an oblique camera cannot turn a sideways drag into a slide — which is
  // exactly what it did when the drag was measured in a plane instead.
  const span = 12 // pixels per metre of cut, whatever the zoom
  assert.equal(dragOffset(0, 0, span), 0, 'no travel, no slide')
  assert.equal(dragOffset(0, 24, span), 2, '24 px along the axis is 2 m of cut')
  assert.equal(dragOffset(-1.5, -24, span), -3.5, 'and it is relative to where the cut already was')
  assert.equal(dragOffset(2, 6, span), 2.5, 'a short drag is a short slide')
  assert.equal(dragOffset(3, 999, 0), 3, 'a cut sliding straight at the camera cannot be dragged at all')

  // The axis is a unit vector in screen space; travel along it is counted whole,
  // travel across it is not counted at all.
  const up = [0, -1]
  const right = [1, 0]
  assert.equal(walkAlong([100, 100], [100, 40], up), 60, 'dragging up the screen walks 60 px along an up axis')
  assert.equal(walkAlong([100, 100], [160, 100], right), 60, 'dragging right walks 60 px along a right axis')
  assert.equal(walkAlong([100, 100], [160, 100], up), 0, 'and dragging right walks nowhere along an up axis')
  assert.equal(walkAlong([100, 100], [100, 40], right), 0, 'and dragging up walks nowhere along a right axis')
  const diag = [Math.SQRT1_2, -Math.SQRT1_2]
  assert.ok(Math.abs(walkAlong([0, 0], [10, -10], diag) - Math.hypot(10, 10)) < 1e-9, 'a diagonal drag on a diagonal axis counts whole')
  assert.ok(Math.abs(walkAlong([0, 0], [-10, -10], diag)) < 1e-9, 'a drag across it counts for nothing')
})

test('the highlight reaches past the station it cuts, whatever its shape', () => {
  assert.equal(sectionHighlightSize([0, 0, 0]), 6, 'an unbuilt station still gets a grabbable surface')
  assert.ok(sectionHighlightSize([40, 20, 12]) > Math.hypot(40, 20, 12) / 2, 'the half-extent covers the diagonal')
  assert.ok(sectionHighlightSize([40, 20, 12]) > sectionHighlightSize([8, 8, 8]), 'and grows with the building')
})
