// The 剖切 section's own arithmetic (`src/render/section.ts`).
//
// The cut is a placed surface now: a location along its normal, an azimuth, an
// elevation. Four things have to agree on it — the clip plane three.js slices
// with, the highlighted surface drawn on it, the ray that snaps the pointer
// onto it and the drag that slides it — so this is where the definitions are
// pinned: which way a fresh cut looks, which half it keeps, what "+0.5 m" does,
// and how a pointer position turns into a slide.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SECTION_AZIMUTH,
  DEFAULT_SECTION_ELEVATION,
  SECTION_SNAP,
  SECTION_SNAP_FINE,
  formatSection,
  planeConstant,
  sectionCoord,
  sectionHighlightSize,
  sectionNormal,
  sectionPoint,
  sectionRight,
  sectionUp,
  slideOffset,
  snapOffset,
} from '../src/render/section.ts'

const orient = (azimuth, elevation) => ({ azimuth, elevation })
const section = (azimuth, elevation, offset, anchor = [0, 0, 0]) => ({ anchor, orientation: orient(azimuth, elevation), offset })
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test('a fresh cut looks north, exactly: +y at both defaults', () => {
  assert.equal(DEFAULT_SECTION_AZIMUTH, 0)
  assert.equal(DEFAULT_SECTION_ELEVATION, 0)
  const n = sectionNormal(orient(0, 0))
  assert.deepEqual([...n].map((v) => Number(v.toFixed(12))), [0, 1, 0], 'the old fixed plane faced +y, and so does the new default')
  assert.ok(close(Math.hypot(...n), 1), 'the normal is a unit vector')
})

test('azimuth turns the look in the horizontal plane, elevation tilts it out', () => {
  const east = sectionNormal(orient(90, 0))
  assert.ok(close(east[0], 1) && close(east[1], 0) && close(east[2], 0), '90° looks east (+x)')
  const south = sectionNormal(orient(180, 0))
  assert.ok(close(south[0], 0) && close(south[1], -1), '180° looks south (−y)')
  const down = sectionNormal(orient(0, 90))
  assert.ok(close(down[2], -1), '+90° looks down: the kept half is the one under the plane')
  const up = sectionNormal(orient(0, -90))
  assert.ok(close(up[2], 1), '−90° looks up from below')
  // Elevation is the tilt *out of* the horizontal plane at every azimuth.
  for (const az of [-135, -90, -45, 0, 45, 90, 135, 180]) {
    const n = sectionNormal(orient(az, 30))
    assert.ok(close(n[2], -0.5), `elevation 30° looks 0.5 down at azimuth ${az}`)
    assert.ok(close(Math.hypot(...n), 1), `still a unit vector at azimuth ${az}`)
  }
})

test('the surface frame is orthonormal, and stays defined looking straight down', () => {
  for (const [az, el] of [[0, 0], [90, 0], [37, 22], [-160, -60], [0, 89], [123, 0]]) {
    const n = sectionNormal(orient(az, el))
    const right = sectionRight(n)
    const up = sectionUp(n, right)
    assert.ok(close(Math.hypot(...right), 1), `right is unit at ${az},${el}`)
    assert.ok(close(Math.hypot(...up), 1), `up is unit at ${az},${el}`)
    assert.ok(close(dot(n, right), 0), `right ⟂ normal at ${az},${el}`)
    assert.ok(close(dot(n, up), 0), `up ⟂ normal at ${az},${el}`)
    assert.ok(close(dot(right, up), 0), `right ⟂ up at ${az},${el}`)
  }
  // The degenerate case: a normal straight up or down has no horizontal part,
  // so the frame has to be *chosen* rather than derived — NaN here would
  // collapse the highlight quad the player drags.
  const straight = sectionNormal(orient(0, 90))
  assert.deepEqual(sectionRight(straight), [1, 0, 0])
  const right = sectionRight(straight)
  assert.ok(close(Math.hypot(...sectionUp(straight, right)), 1))
})

test('offset slides the cut the way the surface faces, and nowhere else', () => {
  const s = section(0, 0, 0, [2, 3, -8])
  assert.deepEqual(sectionPoint(s), [2, 3, -8])
  assert.deepEqual(sectionPoint({ ...s, offset: 1.5 }), [2, 4.5, -8], 'a cut looking north walks north')
  const tilted = section(0, 90, 2, [0, 0, -8])
  assert.ok(close(sectionPoint(tilted)[2], -10), 'a cut looking down walks down')
  assert.ok(close(sectionPoint(tilted)[0], 0) && close(sectionPoint(tilted)[1], 0), 'and not sideways')
})

test('the plane keeps the half behind it: what the surface faces is cut away', () => {
  // three.js keeps `dot(normal, p) + constant >= 0`, with `constant` written as
  // `+d` above, so the kept half is `dot(normal, p) - d >= 0` — everything on
  // the far side of the cut. A cut at y = 3 looking north keeps y ≥ 3: the
  // *northern* half, the one the camera standing south of the cut can see.
  assert.ok(close(planeConstant(section(0, 0, 0, [0, 3, 0])), 3))
  const inside = (s, p) => dot(sectionNormal(s.orientation), p) - planeConstant(s) >= 0
  const s = section(0, 0, 0, [0, 3, 0])
  assert.equal(inside(s, [5, 4, 5]), true, 'the half behind the cut survives')
  assert.equal(inside(s, [5, 2, 5]), false, 'the half the surface has not reached is cut away')
  assert.equal(inside(s, [5, 3, 5]), true, 'the plane itself is inside, so the surface is not clipped off')
  // The constant is the distance from the world origin to the cut along the
  // normal, so it grows as the cut walks the way it looks.
  assert.ok(close(planeConstant({ ...s, offset: 1 }), 4))
  // A downward look keeps everything under it, which is what makes an overhead
  // section of a storey read as a plan.
  const plan = section(0, 90, 0, [0, 0, -4])
  assert.equal(inside(plan, [9, 9, -6]), true, 'the room under the cut survives')
  assert.equal(inside(plan, [9, 9, -2]), false, 'the ceiling above it is cut away')
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

test('a drag follows the pointer along the normal only', () => {
  const o = orient(0, 0)
  const point = [0, 0, 0]
  // Straight along +y: the cut walks the whole way.
  assert.ok(close(slideOffset(0, point, [0, 2, 0], o), 2))
  // Sideways: the projection is zero, so the cut does not move at all.
  assert.ok(close(slideOffset(0, point, [7, 0, -3], o), 0))
  // Diagonal: only the normal component counts.
  assert.ok(close(slideOffset(0, point, [7, 2, -3], o), 2))
  // It is a *relative* slide: where the cut already is does not change the step.
  assert.ok(close(slideOffset(4, point, [0, 1, 0], o), 5))
  // A tilt follows its own look: a downward-facing cut's +offset goes *down*,
  // so the drag that lowers it is the drag straight down (−z).
  assert.ok(close(slideOffset(0, point, [0, 0, -3], orient(0, 90)), 3), 'a downward cut follows a downward drag')
  assert.ok(close(slideOffset(0, point, [0, 0, 3], orient(0, 90)), -3), 'and rises when dragged up')
})

test('the readout names the axis the cut leans on, and the surface value on it', () => {
  assert.deepEqual(sectionCoord(section(0, 0, 0, [1, 2, -8])), { axis: 'y', value: 2 })
  assert.deepEqual(sectionCoord(section(90, 0, 0, [1, 2, -8])), { axis: 'x', value: 1 })
  assert.deepEqual(sectionCoord(section(0, 90, 0, [1, 2, -8])), { axis: 'z', value: -8 })
  // A slide moves the read value with the surface: +2 m on a north-looking cut
  // walks it two metres further north.
  assert.deepEqual(sectionCoord(section(0, 0, 2, [1, 2, -8])), { axis: 'y', value: 4 })
  assert.equal(formatSection(section(0, 0, 1.5, [0, 0, 0])), '+1.5 m · Y 1.5')
  assert.equal(formatSection(section(0, 0, 0, [0, -3, 0])), '0.0 m · Y −3.0')
})

test('the highlight reaches past the station it cuts, whatever its shape', () => {
  assert.equal(sectionHighlightSize([0, 0, 0]), 6, 'an unbuilt station still gets a grabbable surface')
  assert.ok(sectionHighlightSize([40, 20, 12]) > Math.hypot(40, 20, 12) / 2, 'the half-extent covers the diagonal')
  assert.ok(sectionHighlightSize([40, 20, 12]) > sectionHighlightSize([8, 8, 8]), 'and grows with the building')
})
