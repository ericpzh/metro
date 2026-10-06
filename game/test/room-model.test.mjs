// The walled room's own model (`render/models.ts` `buildRoom`): the perimeter is one
// 0.5 m panel per face, and its corners are square. The ring used to be mitred — the
// corner cell filled by a `mitreCap` triangular prism cut on its diagonal — but that
// prism's apex was the *cell's* inner corner, one wall thickness past the room's own,
// so every corner also wore a 0.5 m diagonal wedge laid across the free half of the
// cell (the half a room keeps for furniture). What this pins: the ring is closed the
// whole way round with no gap at a corner, it is one panel thick, the free quarter of
// a corner cell is empty, and nothing in the ring is anything but a box.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildModule } from '../src/render/models.ts'
import { SHOP_WALL_H } from '../src/build/model.ts'
import { moduleEnvelope } from '../src/sim/placement.ts'
import { HALF_WALL_T } from '../src/sim/constants.ts'

const W = 5
const H = 4
const Z = 0
/** The panel's thickness — the room's own number, not a copy of it. */
const T = HALF_WALL_T
/** Halfway up a wall panel, inside its first block. */
const WALL_MID = Z + 1.5

const shop = () => ({ id: 'shop-1', type: 'shop', x: 0, y: 0, z: Z, w: W, h: H, cfg: { kind: 'store', door: [] } })

/** The cells a placed shop has: a floor cell each, and a wall stack over the perimeter. */
function roomCells() {
  const out = []
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      out.push({ x, y, z: Z, fill: 'solid' })
      if (x !== 0 && x !== W - 1 && y !== 0 && y !== H - 1) continue
      for (let dz = 1; dz <= SHOP_WALL_H; dz++) out.push({ x, y, z: Z + dz, fill: 'solid' })
    }
  }
  return out
}

/**
 * Build the room with the lightest context its builder needs — a lazily minted
 * material per name, no station and no DOM — and return its wall panels: a world-space
 * box each, plus the geometry they were drawn from. `buildRoom` draws in world space,
 * so these are the room's own coordinates.
 */
function build() {
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const data = { name: 't', seed: 1, cells: roomCells(), modules: [], lines: [] }
  const group = buildModule(shop(), { mats, data, trackCells: new Set(), finish: () => mats.granite, preview: false })
  group.updateMatrixWorld(true)
  const walls = []
  group.traverse((o) => {
    if (o.isMesh && o.userData.wall) walls.push({ box: new THREE.Box3().setFromObject(o), geometry: o.geometry })
  })
  return walls
}

/** Micron slop: a box corner comes back off `Box3.setFromObject` a few ulps out. */
const EPS = 1e-6
/** Is the world point inside one of these boxes? */
const covers = (boxes, x, y, z) =>
  boxes.some((b) => x >= b.min.x - EPS && x <= b.max.x + EPS && y >= b.min.y - EPS && y <= b.max.y + EPS && z >= b.min.z - EPS && z <= b.max.z + EPS)

test('a room corner is square: three quarters of the corner cell are wall, the free one is empty', () => {
  const boxes = build().map((w) => w.box)
  assert.ok(boxes.length > 0, 'the room drew no walls')
  // Each corner cell in turn, with the direction the room lies in from it (`dx`/`dy`
  // sign the room's own outer face: -1 means the face is on the cell's far side).
  for (const [cx, cy, dx, dy] of [
    [0, 0, 1, 1],
    [W - 1, 0, -1, 1],
    [0, H - 1, 1, -1],
    [W - 1, H - 1, -1, -1],
  ]) {
    // The quarter a room keeps for furniture is the one diagonally opposite its own
    // outer corner: the cell is an L, not a diagonal wedge.
    const free = [cx + (dx > 0 ? 0.75 : 0.25), cy + (dy > 0 ? 0.75 : 0.25)]
    for (const [qx, qy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const x = cx + qx
      const y = cy + qy
      const isFree = x === free[0] && y === free[1]
      assert.equal(covers(boxes, x, y, WALL_MID), !isFree, `corner cell ${cx},${cy} quarter ${qx},${qy} is ${isFree ? 'walled' : 'empty'}`)
    }
    // Square means the corner square's own corner is filled right into the angle: a
    // mitre cut the outer corner and the inner one off on a diagonal.
    const ox = cx + (dx > 0 ? 0.1 : 0.9)
    const oy = cy + (dy > 0 ? 0.1 : 0.9)
    assert.ok(covers(boxes, ox, oy, WALL_MID), `the room's own corner at ${cx},${cy} is not filled`)
  }
})

test('the ring is closed the whole way round, corners included', () => {
  const boxes = build().map((w) => w.box)
  // The line each face's panel runs through — its centre line — sampled at 5 cm, all
  // the way round including both ends of every face. A gap at a corner shows up here.
  const step = 0.05
  const line = []
  for (let a = 0; a <= W + EPS; a += step) line.push([a, T / 2], [a, H - T / 2])
  for (let a = 0; a <= H + EPS; a += step) line.push([T / 2, a], [W - T / 2, a])
  for (const [x, y] of line) assert.ok(covers(boxes, x, y, WALL_MID), `the wall ring has a gap at ${x.toFixed(2)},${y.toFixed(2)}`)
})

test('the ring stays inside the room and the height its module reserves', () => {
  const e = moduleEnvelope(shop())
  for (const { box } of build()) {
    assert.ok(box.min.x >= e.x0 - EPS && box.max.x <= e.x1 + EPS, `a wall leaves the room across x: ${box.min.x}..${box.max.x}`)
    assert.ok(box.min.y >= e.y0 - EPS && box.max.y <= e.y1 + EPS, `a wall leaves the room across y: ${box.min.y}..${box.max.y}`)
    assert.ok(box.min.z >= e.z0 - EPS && box.max.z <= e.z1 + EPS, `a wall leaves the reserved height: ${box.min.z}..${box.max.z}`)
  }
})

test('every room wall is a box: no diagonal prism is left in the ring', () => {
  for (const { geometry } of build()) assert.equal(geometry.type, 'BoxGeometry', 'a room wall is not a box')
})

/**
 * The room's **doorway** (`render/models/pieces/DoorModel.ts` `buildDoor`), built with a
 * one-cell opening on `side`, as world-space boxes. The group is a child of the room's, so
 * it carries the place and the turn the shared builder needs.
 */
function doorway(side) {
  const opening = side === 's' ? [2, 0] : side === 'n' ? [2, H - 1] : side === 'w' ? [0, 2] : [W - 1, 2]
  const mats = new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) })
  const data = { name: 't', seed: 1, cells: roomCells(), modules: [], lines: [] }
  const mod = { ...shop(), cfg: { kind: 'office', door: [opening] } }
  const group = buildModule(mod, { mats, data, trackCells: new Set(), finish: () => mats.granite, preview: false })
  group.updateMatrixWorld(true)
  let found = null
  group.traverse((o) => {
    if (o.name === 'doorway') found = o
  })
  assert.notEqual(found, null, `${side}: the room closed its opening with no doorway`)
  const boxes = []
  found.traverse((o) => {
    if (o.isMesh) boxes.push(new THREE.Box3().setFromObject(o))
  })
  return { boxes, opening, at: found.position, rot: found.rotation.z }
}

test('a room doorway runs along its wall on every side, never through it', () => {
  // `buildDoor` sizes every member in the **piece's** frame — the run along its local x,
  // the depth across it — so a doorway on a west or east wall has to be built into a group
  // that carries the quarter turn. One that mapped only its members' *positions* (the old
  // `turnedDoorFrame`) left the run and the depth swapped there: the head and leaves stood  // 90° transposed, straight through the wall and 0.43 m outside the building. Every other
  // room-doorway test opens on the south wall, where the turn is the identity, so nothing
  // caught it.
  for (const side of ['s', 'n', 'w', 'e']) {
    const { boxes, opening, at } = doorway(side)
    const alongX = side === 's' || side === 'n'
    assert.ok(boxes.length > 0, `${side}: the doorway drew nothing`)
    // The doorway's own line: the middle of the opening, on the wall.
    const mid = alongX ? [opening[0] + 0.5, null, at.z] : [null, opening[1] + 0.5, at.z]
    for (const b of boxes) {
      const run = alongX ? b.max.x - b.min.x : b.max.y - b.min.y
      const depth = alongX ? b.max.y - b.min.y : b.max.x - b.min.x
      // A member's run never crosses the opening (one cell wide, so 1 m of frame at most),
      // and its depth through the wall is a post's, not a run's.
      assert.ok(run <= 1 + 0.2 + EPS, `${side}: a member runs ${run.toFixed(3)} m along the wall`)
      assert.ok(depth <= 0.2 + EPS, `${side}: a member reaches ${depth.toFixed(3)} m through the wall`)
      // The member's own plane sits across the middle of the opening, not beside it.
      if (alongX) assert.ok(Math.abs((b.min.x + b.max.x) / 2 - mid[0]) <= 0.6 + EPS, `${side}: a member is off the opening across x`)
      else assert.ok(Math.abs((b.min.y + b.max.y) / 2 - mid[1]) <= 0.6 + EPS, `${side}: a member is off the opening across y`)
    }
    // The threshold, the head and the leaves all stand on the floor's own top.
    for (const b of boxes) {
      assert.ok(b.min.z >= at.z - EPS && b.max.z <= at.z + 2.1 + EPS, `${side}: a member leaves the doorway's height (${b.min.z}..${b.max.z})`)
    }
  }
})
