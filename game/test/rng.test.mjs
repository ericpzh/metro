// The one RNG the whole simulation draws from (`sim/rng.ts`, §7.6).
//
// `determinism.test.mjs` proves that seed + tick ⇒ the same crowd. This file pins
// the **generator underneath it**: the exact sequence a seed produces, the range each
// helper promises, the Poisson draw the crowd's arrivals are made of, and the state
// the stream can be resumed from. The numbers are golden on purpose — mulberry32 is a
// published algorithm, so a change to these is a change to every recorded crowd, every
// bug report and every save's replay, and it should fail loudly rather than drift.
//
// Three of these helpers (`pick`, `state`, `hashString`) have no caller left in `src/`:
// they are pinned here as the module's API surface, so that whoever decides to delete
// one can see exactly what would be going with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Rng, hashString } from '../src/sim/rng.ts'

test('a seed produces one exact sequence, and two seeds diverge', () => {
  const r = new Rng(1)
  const five = [r.next(), r.next(), r.next(), r.next(), r.next()]
  assert.deepEqual(
    five.map((n) => Number(n.toFixed(10))),
    [0.6270739406, 0.0027357212, 0.52744704, 0.9810509675, 0.9683778982],
    'seed 1 draws the sequence every recorded crowd was built on',
  )
  const other = new Rng(2)
  assert.notEqual(other.next(), five[0], 'a different seed is a different stream')
  // And the stream is a pure function of the seed: two instances agree.
  const twin = new Rng(1)
  assert.equal(twin.next(), five[0])
})

test('every helper stays inside the range it promises', () => {
  const r = new Rng(7)
  assert.equal(r.int(1), 0, 'an int of one value can only be that value')
  const ints = Array.from({ length: 200 }, () => r.int(10))
  assert.ok(ints.every((n) => Number.isInteger(n) && n >= 0 && n < 10), 'int(n) is a whole number below n')
  assert.ok(new Set(ints).size > 5, 'and it is not stuck on one value')
  // The same seed read from the top, so this list is the stream itself and not the
  // stream after the `int(1)` above.
  const fresh = new Rng(7)
  assert.deepEqual(Array.from({ length: 6 }, () => fresh.int(10)), [0, 0, 9, 6, 5, 4], 'this seed’s own first six draws')
  const floats = Array.from({ length: 200 }, () => r.range(-2, 2))
  assert.ok(floats.every((n) => n >= -2 && n < 2), 'range(a, b) is half-open')
  assert.equal(Number(new Rng(3).range(-2, 2).toFixed(10)), 0.8809071351, 'and interpolates the stream')
  assert.equal(r.chance(0), false, 'a zero chance never fires')
  assert.equal(r.chance(1), true, 'and a certain one always does')
  // `pick` is `int` over a length: the same stream, read as an index.
  const one = new Rng(9)
  const picked = Array.from({ length: 50 }, () => one.pick(['a', 'b', 'c']))
  assert.ok(picked.every((v) => ['a', 'b', 'c'].includes(v)), 'pick returns an element of the array')
  assert.ok(new Set(picked).size > 1, 'and reaches more than one of them')
})

test('the Poisson draw is the arrivals process: deterministic, bounded, and zero at zero', () => {
  // One event an hour for one second is λ = 1/3600: the draw is the same every time
  // for the same seed, which is what makes a crowd replayable.
  const once = new Rng(5).poissonHour(3600, 1)
  assert.equal(new Rng(5).poissonHour(3600, 1), once, 'the same seed draws the same count')
  assert.equal(once, 2, 'this seed’s own count for λ = 1')
  assert.equal(new Rng(5).poissonHour(0, 60), 0, 'a zero rate fires nothing')
  assert.equal(new Rng(5).poissonHour(-5, 60), 0, 'and neither does a negative one')
  // The Knuth loop carries a hard cap so a huge λ cannot spin forever.
  assert.equal(new Rng(5).poissonHour(1e9, 1e9), 63, 'an absurd λ stops at the loop’s cap')
  for (let i = 0; i < 50; i++) {
    const n = new Rng(i).poissonHour(600, 1)
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 63, 'every draw is a whole count inside the cap')
  }
})

test('the stream can be saved and resumed from its state', () => {
  const a = new Rng(11)
  a.next()
  a.next()
  const saved = a.state
  const expected = [a.next(), a.next()]
  const b = new Rng(11)
  b.next()
  b.next()
  b.state = saved
  assert.equal(b.next(), expected[0], 'a resumed stream continues where it was')
  assert.equal(b.next(), expected[1])
  // The state is an unsigned 32-bit word — it is written to (and read from) plain
  // numbers, so a signed one would round-trip differently in a save.
  assert.equal(new Rng(11).state >>> 0, new Rng(11).state, 'the state is unsigned')
})

test('hashString is a stable FNV-1a over the string', () => {
  assert.equal(hashString(''), 2166136261, 'the empty string is the FNV offset basis')
  assert.equal(hashString('5号线'), 107544366, 'and a line label hashes to its own value')
  assert.equal(hashString('动物园'), 2100389781, 'a station name included')
  assert.equal(hashString('未命名车站'), 2509905710, 'and the placeholder a fresh station starts on')
  assert.ok(Number.isInteger(hashString('x')) && hashString('x') >= 0, 'the result is an unsigned 32-bit word')
  assert.notEqual(hashString('ab'), hashString('ba'), 'order matters, so it is not a bag of characters')
})
