// B1 acceptance (PLAN.md §6): the formatVersion 1 envelope round-trips the
// static station — cells, finishes, modules and lines — and every failure mode
// returns a named reason and no state, so the open station is never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, serialize, SAVE_VERSION, SAVE_FORMAT } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { DEFAULT_PEAKS, DEFAULT_SERVICE } from '../src/sim/constants.ts'
import { DEFAULT_DEMAND } from '../src/sim/demand.ts'
import { DEFAULT_CALENDAR, SERVICE_MIN_SPAN } from '../src/sim/clock.ts'
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
  assert.deepEqual(r.state.service, state.service, 'the operating hours ride beside the name and the seed')
  assert.deepEqual(r.state.peaks, state.peaks, 'and so do the two peak windows')
  assert.deepEqual(r.state.demand, state.demand, 'and the demand knobs')
  assert.deepEqual(r.state.calendar, state.calendar, 'and the calendar, holiday and 调休 lists included')
})

test('a file with no authored day opens on the defaults', () => {
  // The four fields are station-level config, not part of the cell schema, so a v1 file
  // written before them still loads: absent means the defaults, the same 06:30–23:30,
  // 07:30 / 17:30 and 2026 calendar a fresh station gets.
  const state = toState(scenarioStation())
  const doc = JSON.parse(serialize(state))
  assert.deepEqual(doc.service, DEFAULT_SERVICE, 'and the envelope writes all four out')
  assert.deepEqual(doc.peaks, DEFAULT_PEAKS)
  assert.deepEqual(doc.demand, DEFAULT_DEMAND)
  assert.deepEqual(doc.calendar, DEFAULT_CALENDAR)
  delete doc.service
  delete doc.peaks
  delete doc.demand
  delete doc.calendar
  const r = parse(JSON.stringify(doc))
  assert.equal(r.ok, true)
  assert.deepEqual(r.state.service, DEFAULT_SERVICE)
  assert.deepEqual(r.state.peaks, DEFAULT_PEAKS)
  assert.deepEqual(r.state.demand, DEFAULT_DEMAND)
  assert.deepEqual(r.state.calendar, DEFAULT_CALENDAR)
})

test('an authored day the day cannot hold is bent into range on load', () => {
  const state = toState(scenarioStation())
  const doc = JSON.parse(serialize(state))
  doc.service = { from: 22 * 3600, to: 5 * 3600 } // inverted, as if hand-edited
  const r = parse(JSON.stringify(doc))
  assert.equal(r.ok, true, 'a station with an impossible window still opens')
  assert.deepEqual(r.state.service, { from: 22 * 3600, to: 22 * 3600 + SERVICE_MIN_SPAN })
  doc.service = 'opening time'
  const bad = parse(JSON.stringify(doc))
  assert.equal(bad.ok, true)
  assert.deepEqual(bad.state.service, DEFAULT_SERVICE, 'a field that is not a window at all is not one')
  // The peaks and the knobs are repaired the same way, in place and per field.
  doc.peaks = [{ from: 8 * 3600, to: 8 * 3600 }]
  doc.demand = { amPeak: 99, pmPeak: 'busy', sharpness: 0.5 }
  const repaired = parse(JSON.stringify(doc))
  assert.equal(repaired.ok, true)
  assert.deepEqual(repaired.state.peaks, [
    { from: 8 * 3600, to: 8 * 3600 + SERVICE_MIN_SPAN },
    DEFAULT_PEAKS[1],
  ])
  assert.deepEqual(repaired.state.demand, { amPeak: 2.5, pmPeak: DEFAULT_DEMAND.pmPeak, sharpness: 0.5 })
  // An **array** is not a record: `isRecord([])` is true in JavaScript, so a
  // hand-edited `service: []` has to be refused by shape and fall back to the
  // shipped day rather than be read as a window with no ends.
  doc.service = []
  doc.demand = []
  doc.peaks = {}
  const shaped = parse(JSON.stringify(doc))
  assert.equal(shaped.ok, true)
  assert.deepEqual(shaped.state.service, DEFAULT_SERVICE, 'an empty array is not a window')
  assert.deepEqual(shaped.state.demand, DEFAULT_DEMAND, 'nor is it a set of knobs')
  assert.deepEqual(shaped.state.peaks, DEFAULT_PEAKS, 'and an object is not the pair of windows')
  // The calendar is repaired the same way: an epoch that is not a date falls back to the shipped
  // one, a key that is not `YYYY-MM-DD` is dropped from its list, and a date a hand-edit put on
  // both lists is a holiday.
  doc.calendar = { epoch: { year: 2026, month: 2, day: 31 }, holidays: ['2026-03-01', 'March'], workdays: ['2026-03-01'] }
  const cal = parse(JSON.stringify(doc))
  assert.equal(cal.ok, true)
  assert.deepEqual(cal.state.calendar.epoch, { year: 2026, month: 2, day: 28 }, 'February has no 31st')
  assert.deepEqual(cal.state.calendar.holidays, ['2026-03-01'])
  assert.deepEqual(cal.state.calendar.workdays, [], 'a date on both lists is a holiday')
  doc.calendar = 'the year 2026'
  const noCal = parse(JSON.stringify(doc))
  assert.equal(noCal.ok, true)
  assert.deepEqual(noCal.state.calendar, DEFAULT_CALENDAR, 'a field that is not a calendar is the shipped one')
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
  // Every build command takes its coordinates from a pick (which names whole
  // cells, `render/pickCell.ts`) or from whole-cell arithmetic, so the game cannot
  // mint a cell off the 1 m grid — a save is the only place one can appear. It is
  // also unreachable from inside the game: a pick names whole cells and
  // `removeCells` matches an exact coordinate, so a station that keeps one can
  // never be cleaned. Both boundaries therefore **drop** it rather than refuse the
  // file: the envelope is what earns a refusal, and a station that is otherwise
  // fine is not worth losing over a block no tool can see.
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
