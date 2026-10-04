// B1 acceptance (PLAN.md §6): the formatVersion 1 envelope round-trips the
// static station — cells, finishes, modules and lines — and every failure mode
// returns a named reason and no state, so the open station is never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, serialize, SAVE_VERSION, SAVE_FORMAT } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { scenarioStation } from './support/scenario-station.ts'

test('serialise -> parse is identity for the static station', () => {
  const state = toState(scenarioStation())
  const r = parse(serialize(state))
  assert.equal(r.ok, true)
  assert.equal(r.version, SAVE_VERSION)
  assert.equal(r.state.name, state.name)
  assert.equal(r.state.seed, state.seed)
  assert.deepEqual(r.state.cells, state.cells)
  assert.deepEqual(r.state.modules, state.modules)
  assert.deepEqual(r.state.lines, state.lines)
})

test('finishes survive the round trip', () => {
  const state = toState(scenarioStation())
  const track = state.cells.find((c) => c.finish?.top === 'floor.track')
  assert.ok(track, 'the reference station should carry a track bed')
  const r = parse(serialize(state))
  assert.equal(r.ok, true)
  const again = r.state.cells.find((c) => c.x === track.x && c.y === track.y && c.z === track.z)
  assert.deepEqual(again.finish, { top: 'floor.track' })
})

test('an old line with no termini loads with empty ones', () => {
  // A v1 save written before the per-line direction termini existed: the loader
  // must fill them, not leave undefined.
  const legacy = {
    format: SAVE_FORMAT,
    formatVersion: 1,
    static: {
      cells: [],
      modules: [],
      lines: [
        {
          id: '1',
          name: '1号线',
          colour: '#edcf3b',
          stock: 'B',
          cars: 6,
          power: 'third-rail',
          headwayProfile: { peak: 150, offpeak: 240, late: 480 },
          alightPerTrain: 200,
          terminus: 'through',
          direction: 'up',
          travelSign: 1,
          stations: [],
        },
      ],
    },
  }
  const r = parse(JSON.stringify(legacy))
  assert.equal(r.ok, true)
  assert.equal(r.state.lines[0].upTerminus, '')
  assert.equal(r.state.lines[0].downTerminus, '')
})

test('an off-grid cell is dropped on load, and the grid ones around it survive', () => {
  // Every build command takes its coordinates from a pick (which floors) or from
  // whole-cell arithmetic, so the game cannot mint a cell off the 1 m grid — a save
  // is the only place one can appear. It is also unreachable from inside the game:
  // a pick snaps to integers and `removeCells` matches an exact coordinate, so a
  // station that keeps one can never be cleaned. `toState` drops them, and every
  // load path passes through it (`parse` included).
  const doc = {
    format: SAVE_FORMAT,
    formatVersion: 1,
    name: '网格测试',
    seed: 1,
    static: {
      cells: [
        { x: 3, y: 4, z: 0, fill: 'solid' },
        { x: 3.18349783954761, y: 4, z: 0, fill: 'solid' },   // the author's stray
        { x: 3, y: 5.81649628734174, z: -2, fill: 'solid' },  // and another
        { x: 4, y: 4, z: 0, fill: 'solid' },
      ],
      modules: [],
      lines: [],
    },
  }
  const r = parse(JSON.stringify(doc))
  assert.equal(r.ok, true)
  assert.deepEqual(
    r.state.cells.map((c) => [c.x, c.y, c.z]),
    [[3, 4, 0], [4, 4, 0]],
    'only the cells on the grid survive',
  )
  // Re-saving cannot put them back, so a file that once carried them comes out clean.
  assert.equal(parse(serialize(r.state)).state.cells.length, 2)
})

test('each failure names a Chinese reason and loads nothing', () => {
  const broken = parse('{ not json')
  assert.deepEqual(broken, { ok: false, error: '文件损坏' })

  const wrong = parse(JSON.stringify({ format: 'something-else' }))
  assert.deepEqual(wrong, { ok: false, error: '不是地铁车站存档' })

  const newer = parse(JSON.stringify({ format: SAVE_FORMAT, formatVersion: SAVE_VERSION + 1, static: { cells: [] } }))
  assert.deepEqual(newer, { ok: false, error: '存档太新了，先更新游戏' })

  const missing = parse(JSON.stringify({ format: SAVE_FORMAT, formatVersion: 1 }))
  assert.deepEqual(missing, { ok: false, error: '缺少车站数据' })
})
