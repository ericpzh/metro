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

test('a damaged block is dropped on load and on save, never refused', () => {
  // Every build command takes its coordinates from a pick (which floors) or from
  // whole-cell arithmetic, so the game cannot mint a cell off the 1 m grid — a save
  // is the only place one can appear. It is also unreachable from inside the game:
  // a pick snaps to integers and `removeCells` matches an exact coordinate, so a
  // station that keeps one can never be cleaned. Both boundaries therefore **drop**
  // it rather than refuse the file: the envelope is what earns a refusal, and a
  // station that is otherwise fine is not worth losing over a block no tool can see.
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
      modules: [
        { id: 'ok', type: 'gate', x: 4, y: 5, z: 0, rot: 0, cfg: { dir: 'both', door: 'lane' } },
        { id: 'stray', type: 'gate', x: 4.5, y: 5, z: 0, rot: 0, cfg: { dir: 'both', door: 'lane' } },
      ],
      lines: [],
    },
  }
  const r = parse(JSON.stringify(doc))
  assert.equal(r.ok, true, 'a station with one damaged block still opens')
  assert.equal(r.droppedCells, 2)
  assert.equal(r.droppedModules, 1)
  assert.deepEqual(
    r.state.cells.map((c) => [c.x, c.y, c.z]),
    [[3, 4, 0], [4, 4, 0]],
    'only the cells on the grid survive',
  )
  assert.deepEqual(r.state.modules.map((m) => m.id), ['ok'])
  // Saving drops them too, so a file this game writes cannot carry one however it
  // got into memory — and the round trip stays lossless for what is left.
  const again = parse(serialize(r.state))
  assert.equal(again.ok, true)
  assert.equal(again.droppedCells, 0)
  assert.equal(again.droppedModules, 0)
  assert.deepEqual(again.state.cells, r.state.cells)
  assert.deepEqual(again.state.modules, r.state.modules)
})

test('a value JSON cannot carry is dropped at save time rather than written as null', () => {
  // `NaN`/`±Infinity` stringify to `null`, and a piece read back at `null` is a
  // piece at nowhere — a corrupt file. Built as a state directly, so this is the
  // **save** boundary being tested and not the load repair.
  const state = {
    name: 'NaN 测试',
    seed: 1,
    cells: [{ x: 1, y: 1, z: 0, fill: 'solid' }, { x: Number.NaN, y: 1, z: 0, fill: 'solid' }],
    modules: [{ id: 'nan', type: 'gate', x: Number.POSITIVE_INFINITY, y: 1, z: 0, rot: 0, cfg: { dir: 'both', door: 'lane' } }],
    lines: [],
  }
  const text = serialize(state)
  assert.ok(!text.includes('null'), 'no coordinate was written as null')
  const back = parse(text)
  assert.equal(back.ok, true)
  assert.equal(back.state.cells.length, 1)
  assert.equal(back.state.modules.length, 0)
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
