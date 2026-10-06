// Nothing in the game can put a cell off the 1 m editing grid.
//
// The author's own station arrived carrying 19 such cells (fractional coordinates,
// no tags, no module standing on them). They came from outside the game: every
// build command takes its coordinates either from a pick — which names whole cells,
// `render/pickCell.ts`, whatever angle the drawn surface it hit is at — or from
// whole-cell arithmetic. A save is therefore the only way one can arrive, and one
// that arrives is unreachable from inside the game: a pick names whole cells and
// `removeCells` matches an exact coordinate, so no tool can ever delete it. That is
// why both boundaries drop them instead of trusting them (`build/model.ts`
// `repairGrid`, pinned in `save.test.mjs`) and why the shipped demo is checked in
// `demo.test.mjs`.
//
// This file is the other half: the guard on the code that *makes* stations. If any
// tool ever learns to mint a fraction, this fails — which is the only way that bug
// could reach a player, since a save cannot be written with one either. The pick
// itself is upstream of every command here, so *its* guarantee is pinned against
// real meshed geometry in `pick-cell.test.mjs`: a face drawn off-axis (the wedge
// under a 楼梯 / 扶梯, a rounded block corner) is where this used to leak.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addCells, addEquipment, addFloor, addWalls, carveFacilityOpenings, createModule,
  extendLift, facilityRect, paintFaces, paintZoneCells, placeFacility, replaceEquipment,
  syncAutoWalls, toState, wallRun,
} from '../src/build/model.ts'
import { defaultLine, placeTrack, placeTunnel, regenerateRailEdges, resizeTrack, stripTunnelShell } from '../src/build/rail.ts'
import { moveCandidate } from '../src/sim/placement.ts'
import { stairFlights, stairLandings, stairTurnCells } from '../src/sim/stairs.ts'
import { MODULE_OPTIONS } from '../src/app/store.ts'

const onGrid = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z)
const key = (p) => `${p.x},${p.y},${p.z}`

/** Fail the test, naming the tool and the coordinate, if anything left the grid. */
function assertOnGrid(where, state) {
  for (const c of state.cells ?? []) {
    assert.ok(onGrid(c), `${where}: cell (${c.x}, ${c.y}, ${c.z}) left the grid`)
  }
  for (const m of state.modules ?? []) {
    const points = [m, m.from, m.to, ...(m.type === 'stair' ? (m.cfg.flights ?? []).flatMap((f) => [f.from, f.to]) : [])]
    for (const p of points) {
      assert.ok(!p || onGrid(p), `${where}: ${m.id} (${m.type}) anchor (${p?.x}, ${p?.y}, ${p?.z}) left the grid`)
    }
  }
}

/** A double-deck sandbox: a ground hall, a lower hall and a ceiling to hang from. */
function base() {
  const cells = []
  for (let x = -2; x < 30; x++) {
    for (let y = -2; y < 30; y++) {
      cells.push({ x, y, z: 0, fill: 'solid' })
      cells.push({ x, y, z: -4, fill: 'solid' })
    }
  }
  for (let x = 4; x < 12; x++) for (let y = 4; y < 12; y++) cells.push({ x, y, z: 4, fill: 'solid' })
  return toState({ name: 'grid', seed: 1, cells, modules: [], lines: [] })
}

test('every palette piece is placed on the grid, at every rotation, width and mode', () => {
  const widths = [undefined, 0.68, 1.36, 2.04, 0.7, 1.4, 2]
  let placed = 0
  for (const opt of MODULE_OPTIONS) {
    for (let rot = 0; rot < 4; rot++) {
      for (const width of widths) {
        for (const dir of ['up', 'down']) {
          for (const door of ['lane', 'fence']) {
            const mod = createModule(opt.id, 10, 10, 0, `probe-${placed}`, rot, width, dir, door)
            if (!mod) continue
            assertOnGrid(`createModule(${opt.id}) rot ${rot} width ${width}`, { modules: [mod] })
            assertOnGrid(`placing ${opt.id} rot ${rot} width ${width} ${dir} ${door}`, addEquipment(base(), mod))
            placed++
          }
        }
      }
    }
  }
  // Every palette id must have been exercised, or this guard has a hole.
  assert.ok(placed > 1000, `only ${placed} pieces were placed`)
})

test('a legacy staircase width that is not a whole number of lanes stays on the grid', () => {
  // An old save can carry `width: 1.2` (the demo's earlier snapshot did) and the
  // documented "single piece wider than a cell" is 1.6 m, so a fractional width is
  // the most plausible way a fraction could reach a cell. It reads as the nearest
  // whole lane count and never reaches the grid.
  for (const style of ['straight', 'right90', 'left90', 'right180', 'left180']) {
    for (const width of [0.5, 0.68, 1, 1.2, 1.6, 2.04, 2.8]) {
      for (const rot of [0, 1, 2, 3]) {
        const mod = createModule(`stair-${style}`, 8, 8, -4, `s-${style}-${width}-${rot}`, rot, width)
        assert.ok(mod, `stair-${style} width ${width} should build`)
        const points = [mod, mod.from, mod.to, ...stairFlights(mod).flatMap((f) => [f.from, f.to]), ...stairLandings(mod), ...stairTurnCells(mod)]
        for (const p of points) assert.ok(!p || onGrid(p), `stair-${style} width ${width} rot ${rot}: (${p?.x}, ${p?.y}, ${p?.z})`)
        assertOnGrid(`placing stair-${style} width ${width} rot ${rot}`, addEquipment(base(), mod))
      }
    }
  }
})

test('every other tool lays only whole cells', () => {
  // 方块 (brush + drag + auto walls) and 墙.
  let st = base()
  const patch = []
  for (let x = 20; x < 25; x++) for (let y = 20; y < 25; y++) patch.push([x, y, 0])
  st = { ...st, cells: addCells(st.cells, patch, st.modules).cells }
  assertOnGrid('方块 brush', st)
  assertOnGrid('方块 auto walls', syncAutoWalls(st))
  const run = []
  for (let x = 26; x < 30; x++) run.push([x, 26, 0])
  assertOnGrid('墙 drag', addWalls(st, wallRun(run)).state)
  // The 半墙 mode lays the same column, each course tagged with its own half of
  // the tile: a thickness, never a fraction of a cell.
  assertOnGrid('半墙 drag', addWalls(st, wallRun(run), 'w').state)
  assertOnGrid('方块 addFloor', addFloor(st, patch.map(([x, y, z]) => [x, y, z])))

  // 房间.
  for (const kind of ['store', 'toilet', 'office', 'ticket']) {
    const next = placeFacility(st, kind, facilityRect([14, 14, 0], [20, 20, 0], 0))
    assertOnGrid(`房间 ${kind}`, next)
    const id = next.modules[next.modules.length - 1]?.id
    if (id) {
      const door = next.modules.find((m) => m.id === id)?.cfg?.door ?? []
      assertOnGrid(`房间 ${kind} openings`, carveFacilityOpenings(next, id, door))
    }
  }

  // 电梯: place, then grow a storey each way.
  const lift = createModule('lift', 8, 8, -4, 'lift-1', 0)
  st = addEquipment(st, lift)
  assertOnGrid('电梯 place', st)
  assertOnGrid('电梯 extend up', extendLift(st, 'lift-1', true))
  assertOnGrid('电梯 extend down', extendLift(st, 'lift-1', false))

  // 站台 / 隧道, at an even and an odd run length (the piece is centred on the cell).
  st = { ...st, lines: [defaultLine('1', 'up', 'third-rail')] }
  st = placeTrack(st, { lineId: '1', dir: 'up', power: 'third-rail', rot: 0, x: 2, y: 2, z: 0, w: 20, d: 3 })
  assertOnGrid('站台 w20', st)
  st = placeTrack(st, { lineId: '1', dir: 'up', power: 'third-rail', rot: 1, x: 2, y: 12, z: 0, w: 21, d: 3 })
  assertOnGrid('站台 w21 rot1', st)
  const track = st.modules.find((m) => m.type === 'track')
  st = resizeTrack(st, track, 17)
  assertOnGrid('resizeTrack shorten', st)
  st = resizeTrack(st, { ...track, w: 17 }, 24)
  assertOnGrid('resizeTrack grow', st)
  assertOnGrid('regenerateRailEdges', regenerateRailEdges(st, track.id))
  st = placeTunnel(st, track.id, 6)
  assertOnGrid('隧道', st)
  const tunnel = st.modules.find((m) => m.type === 'track' && m.cfg.tunnel)
  if (tunnel) assertOnGrid('stripTunnelShell', stripTunnelShell(st, tunnel.id))

  // 材质 / 分区 / 移动.
  let painted = paintFaces(st, [[6, 6, 0], [7, 6, 0]], 'top', 'floor.concrete')
  assertOnGrid('材质', painted)
  painted = paintZoneCells(painted, [[6, 6, 0], [7, 6, 0]], 'paid')
  assertOnGrid('分区', painted)
  const gate = createModule('gate', 4, 4, 0, 'gate-1', 1)
  const held = addEquipment(painted, gate)
  const aimed = moveCandidate(held.cells, held.modules, gate, { x: 6, y: 4, z: 0 }, 2)
  assertOnGrid('移动 aim', { cells: held.cells, modules: [aimed.module] })
  assertOnGrid('移动 drop', replaceEquipment(held, aimed.module))
})

test('the grid repair keeps one cell of a translated patch and drops the rest', () => {
  // The shape the author's save actually carried: a 3x3 patch displaced by a fixed
  // fractional offset, so its own spacing is still exactly one cell. `repairGrid`
  // drops it by coordinate, not by shape.
  const cells = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cells.push({ x: x + 0.18349783954761, y, z: 0, fill: 'solid' })
  const state = toState({ name: 'patch', seed: 1, cells, modules: [], lines: [] })
  assert.deepEqual(state.cells, [], 'a whole displaced patch goes, not part of it')
  assert.equal(new Set(cells.map(key)).size, 9, 'the probe really is nine distinct cells')
})
