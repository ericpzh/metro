// Rail placement and auto-derived platform screen doors (GAME-SPEC §5.4, §5.9).
// Placing a rail digs its bed (the cells become void, so the mesher exposes the
// platform edge as a half-metre drop) and generates one platform-edge per
// contiguous run of platform floor beside the bed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultLine, derivePlatformEdges, dropDerivedEdges, isPlatformCell, placeRail, placeTrack, placeTunnel, railModuleAt, regenerateRailEdges, resizeTrack, setLinePower, stripTunnelShell, TUNNEL_SHELL, trackBlockReason, trackClearanceBlocked, trackFloorMissing, trackPieceForLine } from '../src/build/rail.ts'
import { trackCellAt, trackCells, trackOriginForCentre } from '../src/sim/track.ts'
import { moduleEnvelope, placementOnTrack, trackBedKeys, trackAt } from '../src/sim/placement.ts'
import { World } from '../src/sim/world.ts'

function station(cells) {
  return { name: '测试', seed: 1, cells, modules: [], lines: [defaultLine('1', 'up', 'third-rail')] }
}

function floorRow(x0, x1, y, finish = 'floor.granite') {
  const out = []
  for (let x = x0; x <= x1; x++) out.push({ x, y, z: 0, fill: 'solid', finish: { top: finish } })
  return out
}

test('placing a rail digs the bed, lays the track and derives the screen doors', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })

  // The bed course is gone; the platform block stays.
  assert.equal(s1.cells.some((c) => c.y === 1 && c.z === 0), false, 'the bed is dug')
  assert.equal(s1.cells.some((c) => c.y === 0), true, 'the platform floor stays')

  const track = s1.modules.find((m) => m.type === 'track')
  assert.ok(track, 'a track module is placed')
  assert.equal(track.w, 6)
  assert.equal(track.d, 1)
  assert.equal(track.cfg.line, '1')

  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.equal(edges.length, 1, 'one edge on the platform side')
  assert.equal(edges[0].y, 0, 'the edge sits on the platform row')
  assert.equal(edges[0].w, 6)
  // The platform is south of the bed, so the track lies on the edge's +y: the
  // screen's "right" side. The header must face the platform, never the rail.
  assert.equal(edges[0].cfg.side, 'right', 'the derived screen faces the platform')
  assert.equal(edges[0].cfg.from, track.id, 'the edge remembers its rail')
})

test('an island platform beside both sides yields two edges', () => {
  const cells = [...floorRow(0, 4, 0), ...floorRow(0, 4, 1), ...floorRow(0, 4, 2)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 4, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.equal(edges.length, 2)
  assert.deepEqual(edges.map((e) => e.y).sort(), [0, 2])
  // The row at y = 0 is south of the bed (track on its +y → "right"); the row at
  // y = 2 is north (track on its −y → "left").
  const byY = edges.slice().sort((a, b) => a.y - b.y)
  assert.deepEqual(byY.map((e) => e.cfg.side), ['right', 'left'])
})

test('a wall above a platform cell splits the derived edge', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), { x: 2, y: 0, z: 1, fill: 'solid' }]
  assert.equal(isPlatformCell(cells, 2, 0, 0), false, 'a cell with a wall above is not platform floor')
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.deepEqual(edges.map((e) => [e.x, e.w]), [[0, 2], [3, 3]], 'split either side of the wall')
})

test('regeneration is idempotent and follows the current platform floor', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const track = s1.modules.find((m) => m.type === 'track')
  const once = regenerateRailEdges(s1, track.id)
  const twice = regenerateRailEdges(once, track.id)
  assert.equal(twice.modules.filter((m) => m.type === 'platform-edge').length, 1, 'no duplicate edges')

  // Withdraw the platform: the derived edge goes away.
  const bare = { ...s1, cells: s1.cells.filter((c) => c.y !== 0) }
  const regen = regenerateRailEdges(bare, track.id)
  assert.equal(regen.modules.filter((m) => m.type === 'platform-edge').length, 0)
})

test('the dug bed blocks equipment and reads as track by either rule', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const track = s1.modules.find((m) => m.type === 'track')

  assert.ok(trackAt(s1.modules, 3, 1, 0), 'trackAt finds the bed')
  assert.ok(railModuleAt(s1, 0, 1, 0), 'the inspector finds the rail')
  assert.ok(trackBedKeys(s1.cells, s1.modules).has('3,1,0'), 'the bed is a track key')

  const env = moduleEnvelope(track)
  assert.equal(env.z0, 0)
  assert.equal(env.z1, 1, 'the trench fills the block, so equipment cannot sit in it')
  assert.equal(placementOnTrack(s1.cells, { id: 'g', type: 'gate', x: 2, y: 1, z: 0, cfg: { dir: 'both' } }, s1.modules), true, 'equipment is refused in the bed')

  const removed = dropDerivedEdges(s1, track.id)
  assert.equal(removed.modules.filter((m) => m.type === 'platform-edge').length, 0)
})

test('a second rail may not overlap the first bed', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1), ...floorRow(0, 5, 2)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const again = placeRail(s1, { x0: 3, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(again, s1, 'an overlapping rail is refused unchanged')
})

test('a rail with no platform still gets a running train', () => {
  const cells = []
  for (let x = 0; x < 40; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const s0 = station(cells)
  const s1 = placeRail(s0, { x0: 0, y0: 0, x1: 39, y1: 2, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  assert.equal(s1.modules.filter((m) => m.type === 'platform-edge').length, 0, 'nothing beside the bed')

  // The anchor comes from the track, not the edge, so the consist appears.
  const w = new World(s1, 99)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.equal(pose.length, 9, 'one train, one pose')
  assert.equal(pose[3], 6, 'six cars')
  assert.equal(pose[2], 0.5, 'rides the recessed slab')
  assert.equal(pose[8], 0, 'an east–west track has no yaw')
})

test('a fresh line is B stock, six cars, and carries the rail direction', () => {
  const line = defaultLine('3', 'down', 'catenary')
  assert.equal(line.id, '3')
  assert.equal(line.name, '3号线')
  assert.equal(line.stock, 'B')
  assert.equal(line.cars, 6)
  assert.equal(line.power, 'catenary')
  assert.equal(line.direction, 'down')
  assert.equal(line.travelSign, 1)
  // A line is born wearing the Guangzhou Metro sign colour for its number.
  assert.equal(line.colour, '#e89e47', 'line 3 is the Guangzhou orange')
  assert.equal(defaultLine('1', 'up', 'third-rail').colour, '#edcf3b', 'line 1 is yellow')
  assert.equal(defaultLine('2', 'up', 'third-rail').colour, '#00679e', 'line 2 is blue')
  assert.equal(defaultLine('99', 'up', 'third-rail').colour, '#2f7ef2', 'unknown numbers fall back')
})

test('a track piece is sized from the line: a car-width bed, the train length', () => {
  const line = defaultLine('1', 'up', 'third-rail') // B stock, six cars
  assert.deepEqual(trackPieceForLine(line), { w: 117, d: 3 }, '6 × 19.5 m = 117 m')
  assert.deepEqual(trackPieceForLine({ stock: 'A', cars: 8 }), { w: 176, d: 3 }, 'A stock, eight cars')
  assert.deepEqual(trackPieceForLine({ stock: 'C', cars: 4 }), { w: 76, d: 3 }, 'C stock, four cars')
})

test('a 供电 switch re-cuts every track bound to the line, platform and tunnel alike', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  let s = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const src = s.modules.find((m) => m.type === 'track')
  s = placeTunnel(s, src.id, 4)
  const tunnel = s.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.ok(tunnel, 'a tunnel run exists')
  assert.equal(tunnel.cfg.power, 'third-rail', 'the tunnel inherits its source power')

  // A second line's rail must not be dragged along by the switch.
  const other = { id: 't9', type: 'track', x: 0, y: 4, z: 0, w: 3, d: 1, cfg: { line: '2', power: 'third-rail' } }
  s = { ...s, lines: [...s.lines, defaultLine('2', 'up', 'third-rail')], modules: [...s.modules, other] }

  const switched = setLinePower(s, '1', 'catenary')
  assert.equal(switched.lines.find((l) => l.id === '1').power, 'catenary')
  for (const m of switched.modules) {
    if (m.type === 'track' && m.cfg.line === '1') assert.equal(m.cfg.power, 'catenary', `${m.id} follows the line`)
  }
  assert.equal(switched.modules.find((m) => m.id === 't9').cfg.power, 'third-rail', 'another line is untouched')
  // The platform-edge derives from the track, so it stays bound to the line.
  assert.equal(switched.modules.some((m) => m.type === 'platform-edge' && m.cfg.line === '1'), true)
})

test('a quarter-turned track digs a north–south bed and derives side edges', () => {
  // A three-column apron; the rail runs north–south up the middle column.
  const cells = []
  for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0, fill: 'solid' })
  const s1 = placeTrack(station(cells), { lineId: '1', dir: 'up', power: 'third-rail', rot: 1, x: 1, y: 0, z: 0, w: 5, d: 1 })

  const track = s1.modules.find((m) => m.type === 'track')
  assert.equal(track.w, 5)
  assert.equal(track.rot, 1, 'the piece keeps its quarter turn')
  // Local +x maps to +y, so the bed is the column x = 1, y = 0..4.
  const bed = trackCells(track).map(([x, y]) => `${x},${y}`).sort()
  assert.deepEqual(bed, ['1,0', '1,1', '1,2', '1,3', '1,4'])
  assert.equal(trackCellAt(track, 1, 4, 0), true)
  assert.equal(trackCellAt(track, 4, 1, 0), false, 'the old x-run reading no longer holds')

  // Both neighbours are platform floor, so two edges run north–south.
  const edges = s1.modules.filter((m) => m.type === 'platform-edge')
  assert.equal(edges.length, 2)
  assert.ok(edges.every((e) => e.rot === 1 && e.w === 5), 'the doors inherit the rail’s rotation')
  assert.deepEqual(edges.map((e) => e.x).sort(), [0, 2], 'one edge on each side')
  // rot 1 turns the run onto +y; the x = 0 edge is west of the bed (track on its
  // +x, i.e. local −y → "left"), the x = 2 edge is east ("right").
  const byX = edges.slice().sort((a, b) => a.x - b.x)
  assert.deepEqual(byX.map((e) => e.cfg.side), ['left', 'right'])
})

test('a north–south rail runs its train in y with a quarter-turn yaw', () => {
  // Only the rail column is floor, so there is no platform edge to shift it.
  const cells = []
  for (let y = 0; y < 10; y++) cells.push({ x: 1, y, z: 0, fill: 'solid' })
  const s1 = placeTrack(station(cells), { lineId: '1', dir: 'up', power: 'third-rail', rot: 1, x: 1, y: 0, z: 0, w: 10, d: 1 })
  const w = new World(s1, 7)
  w.tickOnce()
  const pose = w.trainRenderState()
  assert.equal(pose.length, 9)
  assert.equal(pose[0], 0.5, 'x is fixed at the bed centre')
  assert.ok(Math.abs(pose[8] - Math.PI / 2) < 1e-6, 'the consist is turned onto the run axis')
  // The run direction is +y, so the approach offset shows up in y, not x.
  assert.notEqual(pose[1], 5, 'the train is not sitting on the mark yet')
})

test('changing the line consist re-cuts the track to the new run length', () => {
  const cells = [...floorRow(0, 9, 0), ...floorRow(0, 9, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 4, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const track = s1.modules.find((m) => m.type === 'track')
  const s2 = resizeTrack(s1, track, 7)
  const t2 = s2.modules.find((m) => m.type === 'track')
  assert.equal(t2.w, 7, 'the piece grows with the consist')
  assert.equal(s2.cells.some((c) => c.y === 1 && c.x >= 5 && c.x <= 6), false, 'the extra bed is dug')
  assert.equal(s2.modules.find((m) => m.type === 'platform-edge').w, 7, 'the doors follow the new run')
  assert.equal(resizeTrack(s1, track, 5), s1, 'the same length is a no-op')
})

test('a piece is centred on the highlighted cell', () => {
  // Odd run (117): the anchor is the exact middle cell.
  assert.deepEqual(trackOriginForCentre(0, 10, 5, 117, 3), [10 - 58, 5 - 1])
  // Quarter-turned, even run (20): the origin steps round the anchor.
  assert.deepEqual(trackOriginForCentre(1, 10, 5, 20, 3), [11, -4])
  // Centring a track puts the anchor inside its own footprint.
  const cells = trackCells({ id: 't', type: 'track', x: 10 - 58, y: 5 - 1, z: 0, w: 117, d: 3, rot: 0, cfg: { line: '1', power: 'third-rail' } })
  assert.ok(cells.some(([x, y]) => x === 10 && y === 5), 'the highlighted cell is on the piece')
})

test('a tunnel auto-extends off the free end and never spawns platform doors', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const src = s1.modules.find((m) => m.type === 'track')
  const doorsBefore = s1.modules.filter((m) => m.type === 'platform-edge').length

  // Both ends free: the first extension goes forward, abutting the source.
  const s2 = placeTunnel(s1, src.id, 4)
  const fwd = s2.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.ok(fwd, 'a tunnel module is added')
  assert.equal(fwd.x, src.x + src.w, 'it abuts the source’s forward end')
  assert.equal(fwd.y, src.y)
  assert.equal(fwd.w, 4)
  assert.equal(fwd.rot ?? 0, src.rot ?? 0)
  assert.equal(s2.modules.filter((m) => m.type === 'platform-edge').length, doorsBefore, 'a tunnel is a pure run, no doors')

  // With the forward end now occupied, the next extension goes backward and
  // ends where the source begins.
  const s3 = placeTunnel(s2, src.id, 3)
  const back = s3.modules.find((m) => m.type === 'track' && m.cfg.tunnel && m.x < src.x)
  assert.ok(back, 'the second extension takes the free end')
  assert.equal(back.x + back.w, src.x, 'it abuts the source’s backward end')

  // A tunnel keeps the source's 上行/下行 direction, so the preview arrows agree.
  assert.equal(fwd.cfg.dir, src.cfg.dir, 'the extension inherits the source direction')
  assert.equal(back.cfg.dir, src.cfg.dir)

  // Continuing from the forward tunnel extends further forward.
  const s4 = placeTunnel(s3, fwd.id, 2)
  const more = s4.modules.find((m) => m.type === 'track' && m.cfg.tunnel && m.x > src.x + src.w)
  assert.ok(more, 'a tunnel extends the tunnel')

  // A quarter-turned source extends along its own axis.
  const apron = []
  for (let y = 0; y < 8; y++) apron.push({ x: 1, y, z: 0, fill: 'solid' })
  const r1 = placeTrack(station(apron), { lineId: '1', dir: 'up', power: 'third-rail', rot: 1, x: 1, y: 0, z: 0, w: 5, d: 1 })
  const ns = placeTunnel(r1, r1.modules.find((m) => m.type === 'track').id, 3)
  const nsTunnel = ns.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.equal(nsTunnel.x, 1)
  assert.equal(nsTunnel.y, 5, 'the extension continues north–south')
  assert.equal(nsTunnel.rot, 1)
})

test('a platform refuses a wall in its headroom', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  for (let dz = 1; dz <= 4; dz++) cells.push({ x: 3, y: 1, z: dz, fill: 'solid' })
  const s0 = station(cells)
  const blocked = placeTrack(s0, { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 1, z: 0, w: 6, d: 1 })
  assert.equal(blocked, s0, 'the platform is refused, state unchanged')
  assert.equal(trackClearanceBlocked(s0, { id: 't', type: 'track', x: 0, y: 1, z: 0, w: 6, d: 1, rot: 0, cfg: { line: '1', power: 'third-rail' } }), true)
})

test('a tunnel clears the wall it pokes through and raises its own shell', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const src = s1.modules.find((m) => m.type === 'track')
  // A wall crosses the tunnel's forward path at x = 7, rising 1..4.
  for (let dz = 1; dz <= 4; dz++) cells.push({ x: 7, y: 1, z: dz, fill: 'solid' })
  const s2 = placeTunnel({ ...s1, cells }, src.id, 4)
  const tunnel = s2.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  const has = (x, y, z) => s2.cells.some((c) => c.x === x && c.y === y && c.z === z && c.fill === 'solid')
  const tagged = (x, y, z) => s2.cells.some((c) => c.x === x && c.y === y && c.z === z && c.tags?.includes(`${TUNNEL_SHELL}:${tunnel.id}`))

  // The tunnel runs x = 6..9 at y = 1; the wall inside the bore (z = 1..3) is gone.
  assert.equal(has(7, 1, 1), false, 'the wall through the bore is deleted')
  assert.equal(has(7, 1, 3), false)
  // The ceiling sits one storey up, across the bore. Where a course already
  // stood (the wall's top at x = 7) it is reused rather than tagged.
  for (let x = 6; x <= 9; x++) assert.ok(has(x, 1, 4), `ceiling solid at ${x}`)
  for (const x of [6, 8, 9]) assert.ok(tagged(x, 1, 4), `new ceiling tagged at ${x}`)
  // Side walls flank the bore, full storey tall.
  for (let x = 6; x <= 9; x++) {
    for (let dz = 1; dz <= 4; dz++) {
      assert.ok(tagged(x, 0, dz), `left wall ${x},${dz}`)
      assert.ok(tagged(x, 2, dz), `right wall ${x},${dz}`)
    }
  }
  // Removing the tunnel takes its shell with it.
  const stripped = stripTunnelShell(s2, tunnel.id)
  assert.equal(stripped.cells.some((c) => c.tags?.includes(`${TUNNEL_SHELL}:${tunnel.id}`)), false)
})

test('a platform needs the whole bed on floor and blocks on any interference', () => {
  // A three-wide strip, with one cell missing so it is only two wide at x = 3.
  const cells = []
  for (let y = 0; y < 3; y++) for (let x = 0; x <= 5; x++) {
    if (x === 3 && y === 2) continue
    cells.push({ x, y, z: 0, fill: 'solid' })
  }
  const piece = { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 0, y: 0, z: 0, w: 6, d: 3 }
  const s0 = station(cells)
  assert.equal(placeTrack(s0, piece), s0, 'a bed over a hole is refused')
  assert.equal(trackFloorMissing(s0, { id: 't', type: 'track', ...piece, cfg: { line: '1', power: 'third-rail' } }), true)
  assert.equal(trackBlockReason(s0, { id: 't', type: 'track', ...piece, cfg: { line: '1', power: 'third-rail' } }), 'floor')

  // Complete the strip and it places.
  const filled = { ...s0, cells: [...cells, { x: 3, y: 2, z: 0, fill: 'solid' }] }
  assert.notEqual(placeTrack(filled, piece), filled)

  // Anything already in the way blocks it: a gate, a room, another track.
  const withGate = { ...filled, modules: [{ id: 'g', type: 'gate', x: 3, y: 1, z: 0, cfg: { dir: 'both' } }] }
  assert.equal(placeTrack(withGate, piece), withGate, 'a gate on the bed blocks it')
  const withRoom = { ...filled, modules: [{ id: 'r', type: 'shop', x: 2, y: 0, z: 0, w: 2, h: 2, cfg: { kind: 'store' } }] }
  assert.equal(placeTrack(withRoom, piece), withRoom, 'a room on the bed blocks it')
  const withTrack = { ...filled, modules: [{ id: 't2', type: 'track', x: 2, y: 1, z: 0, w: 2, d: 1, cfg: { line: '1', power: 'third-rail', tunnel: true } }] }
  assert.equal(placeTrack(withTrack, piece), withTrack, 'another track blocks it')
})

test('a tunnel may hang over void but still blocks on equipment', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const src = s1.modules.find((m) => m.type === 'track')
  // The forward run x = 6..9 has no floor at all; a tunnel still extends there.
  assert.notEqual(placeTunnel(s1, src.id, 4), s1, 'a tunnel hangs over void')

  // Equipment standing in that run does block it.
  const s2 = { ...s1, modules: [...s1.modules, { id: 'g', type: 'gate', x: 8, y: 1, z: 0, cfg: { dir: 'both' } }] }
  assert.equal(placeTunnel(s2, src.id, 4), s2, 'a gate in the tunnel path blocks it')
})

test('the track direction sets which way the train runs', () => {
  const cells = []
  for (let x = 0; x < 40; x++) for (let y = 0; y < 3; y++) cells.push({ x, y, z: 0, fill: 'solid' })
  const at = (dir) => new World(placeTrack(station(cells), { lineId: '1', dir, power: 'third-rail', rot: 0, x: 0, y: 0, z: 0, w: 40, d: 3 }), 5)
  const up = at('up'); up.tickOnce()
  const down = at('down'); down.tickOnce()
  assert.equal(up.trainRenderState()[7], 1, '上行 runs +run')
  assert.equal(down.trainRenderState()[7], -1, '下行 runs −run')
})

test('a tunnel snaps to the hovered end', () => {
  const cells = [...floorRow(0, 5, 0), ...floorRow(0, 5, 1)]
  const s1 = placeRail(station(cells), { x0: 0, y0: 1, x1: 5, y1: 1, z: 0 }, { lineId: '1', dir: 'up', power: 'third-rail' })
  const src = s1.modules.find((m) => m.type === 'track')
  // Hovering the west cell extends the west end, not the far one.
  const west = placeTunnel(s1, src.id, 4, [0, 1, 0]).modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.equal(west.x + west.w, src.x, 'west hover extends west')
  // Hovering the east cell extends the east end.
  const east = placeTunnel(s1, src.id, 4, [5, 1, 0]).modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  assert.equal(east.x, src.x + src.w, 'east hover extends east')
})

test('the reference station ships a dug bed with an auto-consistent edge', async () => {
  const { referenceStation } = await import('../src/data/reference-station.ts')
  const s = referenceStation()
  const track = s.modules.find((m) => m.type === 'track')
  assert.ok(track, 'the demo lays a track module')
  assert.equal(track.d, 3, 'a three-metre bed fits the Type-B car')
  // The bed cells are dug, so nothing is left painted floor.track under it.
  for (let x = track.x; x < track.x + track.w; x++) {
    for (let y = track.y; y < track.y + (track.d ?? 1); y++) {
      assert.equal(s.cells.some((c) => c.x === x && c.y === y && c.z === track.z), false)
    }
  }
  // The hand-authored demo edge must agree with the auto-derive, or a player
  // who places the same rail would get a screen facing the other way.
  const edge = s.modules.find((m) => m.type === 'platform-edge')
  const derived = derivePlatformEdges(s, track).find((e) => e.x === edge.x && e.y === edge.y)
  assert.ok(derived, 'the demo edge is the one the derive would place')
  assert.equal(edge.cfg.side, derived.cfg.side, 'the demo edge keeps the derived side')
})
