// B1 acceptance (PLAN.md §6): the formatVersion 1 envelope round-trips the
// static station — cells, finishes, modules and lines — and every failure mode
// returns a named reason and no state, so the open station is never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parse, serialize, SAVE_VERSION, SAVE_FORMAT } from '../src/persistence/save.ts'
import { toState } from '../src/build/model.ts'
import { referenceStation } from '../src/data/reference-station.ts'

test('serialise -> parse is identity for the static station', () => {
  const state = toState(referenceStation())
  const r = parse(serialize(state))
  assert.equal(r.ok, true)
  assert.equal(r.version, SAVE_VERSION)
  assert.equal(r.state.name, state.name)
  assert.equal(r.state.seed, state.seed)
  assert.deepEqual(r.state.levels, state.levels)
  assert.deepEqual(r.state.cells, state.cells)
  assert.deepEqual(r.state.modules, state.modules)
  assert.deepEqual(r.state.lines, state.lines)
})

test('finishes survive the round trip', () => {
  const state = toState(referenceStation())
  const track = state.cells.find((c) => c.finish?.top === 'floor.track')
  assert.ok(track, 'the reference station should carry a track bed')
  const r = parse(serialize(state))
  assert.equal(r.ok, true)
  const again = r.state.cells.find((c) => c.x === track.x && c.y === track.y && c.z === track.z)
  assert.deepEqual(again.finish, { top: 'floor.track' })
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
