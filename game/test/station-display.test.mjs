// The 电视 passenger-information screen (`render/stationDisplay.ts`).
//
// A platform TV is not a poster on a wall: it is a line-branded departure board
// with a **window** in the middle where the network feed plays. These tests pin
// the two things that make that shape work and that a careless edit would break:
// the geometry (the window must never sit on top of the station information) and
// the derivation of "what is the next train", which is what the board prints and
// what the content cadence is wrapped around.
//
// The third thing is the plate itself: `drawStationDisplay` and its cards are the
// only code that puts pixels on the screen, and a plate that prints nothing looks
// exactly like a screen that is off. That half is driven through a recording 2D
// context (`test/support/stub-canvas.mjs`) and read back word by word — what the
// three cards say, which colour the strap turns, and that no word strays into the
// artwork's half of the screen.
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATION_PLATE, TV_POSTER_RECT, drawStationDisplay, stationDisplayLayout, tvLineStatus } from '../src/render/stationDisplay.ts'
import { stubCanvas } from './support/stub-canvas.mjs'

/** A line with a known direction, headway and terminus. */
function line(over = {}) {
  return {
    id: '5',
    name: '5号线',
    colour: '#c8102e',
    stock: 'B',
    cars: 6,
    power: 'third-rail',
    headwayProfile: { peak: 4, offpeak: 7, late: 10 },
    alightPerTrain: 40,
    terminus: 'reverse',
    direction: 'up',
    upTerminus: '番禺广场',
    downTerminus: '滘口',
    travelSign: 1,
    stations: [],
    ...over,
  }
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('the board and the window tile the screen with nothing in between', () => {
  const { header, poster, cards, strip, clock } = stationDisplayLayout()
  const plate = { x: 0, y: 0, w: STATION_PLATE.width, h: STATION_PLATE.height }
  // The split is exact: the column ends precisely where the window starts, and the
  // window runs to the plate's right edge. Any padding on the column's right (or
  // the window's left) shows up as dead black between the text and the picture.
  for (const part of [header, ...cards, strip, clock]) {
    assert.ok(
      Math.abs(part.x + part.w - poster.x) < 1e-6,
      `the column stops ${(poster.x - (part.x + part.w)).toFixed(1)}px short of the window`,
    )
  }
  assert.ok(Math.abs(poster.x + poster.w - plate.w) < 1e-6, 'the window does not reach the plate edge')
  // Full height, so the artwork has no letterbox above or below it.
  assert.equal(poster.y, 0)
  assert.equal(poster.h, plate.h)
})

test('the text never runs under the full-height window', () => {
  const { header, poster, cards, strip, clock } = stationDisplayLayout()
  for (const part of [header, ...cards, strip, clock]) {
    assert.ok(!overlaps(poster, part), `the window covers a text element at y=${part.y}`)
    assert.ok(part.x + part.w <= poster.x + 1e-6, 'a text element ran under the window')
  }
})

test('the content window never overlaps the station information', () => {
  const { header, poster, cards, strip, clock } = stationDisplayLayout()
  const plate = { x: 0, y: 0, w: STATION_PLATE.width, h: STATION_PLATE.height }
  // The window is the one region allowed to carry artwork, so it must be inside
  // the plate and clear of every piece of chrome.
  const inside = poster.x >= 0 && poster.y >= 0 && poster.x + poster.w <= plate.w && poster.y + poster.h <= plate.h
  assert.ok(inside, `the content window left the plate: ${JSON.stringify(poster)}`)
  assert.ok(!overlaps(poster, header), 'the content window covers the line header')
  assert.ok(!overlaps(poster, strip), 'the content window covers the service strip')
  assert.ok(!overlaps(poster, clock), 'the content window covers the clock')
  for (const card of cards) assert.ok(!overlaps(poster, card), `the content window covers a card at y=${card.y}`)
})

test('the left column holds the header, three cards, the strip and the clock', () => {
  const { header, poster, cards, strip, clock } = stationDisplayLayout()
  assert.equal(cards.length, 3, 'the board prints this, next and third train')
  // Everything except the window is left of it, and stacked top to bottom. The
  // clock especially: it is part of the board, not a plate corner the artwork
  // would paint over.
  for (const part of [header, ...cards, strip, clock]) assert.ok(part.x + part.w <= poster.x, 'the column ran under the window')
  assert.ok(header.y < cards[0].y, 'the header sits above the cards')
  assert.ok(cards[0].y + cards[0].h <= cards[1].y, 'the cards overlap')
  assert.ok(cards[1].y + cards[1].h <= cards[2].y, 'the cards overlap')
  assert.ok(cards[2].y + cards[2].h <= strip.y, 'the strip overlaps the third card')
  assert.ok(strip.y + strip.h <= clock.y, 'the clock overlaps the strip')
  assert.ok(clock.y + clock.h <= STATION_PLATE.height, 'the clock ran off the plate')
})

test('the plate keeps the window on the right and the information on the left', () => {
  // The fraction is the contract between the plate texture and the model: the TV
  // builds its board and window meshes at this fraction of the screen, so a plate
  // drawn with a different split would print the board under the artwork.
  assert.ok(TV_POSTER_RECT.x > 0.25 && TV_POSTER_RECT.x < 0.5, 'the window should start past the information column')
  // Exact tiling: no room between the halves for a black seam.
  assert.equal(TV_POSTER_RECT.x + TV_POSTER_RECT.w, 1, 'the two regions must tile the screen exactly')
})

test('with nothing in the approach window the board falls back to the headway', () => {
  const status = tvLineStatus(line(), [], [110, 0.5])
  assert.equal(status.terminus, '番禺广场', 'an up line prints its up terminus')
  assert.equal(status.minutes, null, 'no train in the window means there is no countdown to print')
  assert.equal(status.atPlatform, false)
  assert.equal(status.headway, 4, 'the strip still prints the line headway')
})

test('an approaching train on the same track becomes the countdown', () => {
  // 100 m short of the berth, on the right lane for travelSign +1.
  const status = tvLineStatus(line(), [{ x: 10, y: 0.5, lineId: '5' }], [110, 0.5])
  assert.equal(status.minutes, 1, 'a train 100 m out is about a minute away')
  assert.equal(status.atPlatform, false)
})

test('a train level with the berth reads as at the platform', () => {
  const status = tvLineStatus(line(), [{ x: 108, y: 0.5, lineId: '5' }], [110, 0.5])
  assert.equal(status.atPlatform, true, 'a train standing at the mark is not "arriving"')
  assert.equal(status.minutes, 0)
})

test('a train already past the berth is not counted', () => {
  const status = tvLineStatus(line(), [{ x: 400, y: 0.5, lineId: '5' }], [110, 0.5])
  assert.equal(status.atPlatform, false, 'a departed train is not at the platform')
  assert.equal(status.minutes, null, 'and it is not the next one either')
})

test('a train on the other track is another platform’s train', () => {
  // travelSign +1 runs along x, so y is the lane; 20 m across is a different track.
  const status = tvLineStatus(line(), [{ x: 10, y: 20.5, lineId: '5' }], [110, 0.5])
  assert.equal(status.minutes, null, 'a train on the opposite track must not drive this board')
})

test('a line that has not been given a terminus prints its own direction', () => {
  const up = tvLineStatus(line({ upTerminus: '' }), [], [110, 0.5])
  assert.equal(up.terminus, '上行', 'an unset terminus falls back to the direction word')
  // A down line prints the other end of the line.
  const down = tvLineStatus(line({ direction: 'down' }), [], [110, 0.5])
  assert.equal(down.terminus, '滘口')
})

test('a train bound for another line is ignored', () => {
  const status = tvLineStatus(line(), [{ x: 10, y: 0.5, lineId: '1' }], [110, 0.5])
  assert.equal(status.minutes, null, 'only this line’s own trains count')
})

/* ------------------------------------------------- what the plate prints */

// The pixels are the other half of the screen, and the same silence applies: a plate
// that prints nothing is indistinguishable from a screen that is off, and a plate
// that prints the *wrong* board (an old terminus, a countdown with no train behind it)
// looks exactly like a correct one until a passenger reads it. So the drawing is
// driven through the recording 2D context and read back: every word, its size and
// where it landed.

/** Draw one plate the way `PlateSystem` does, and read back what it printed. */
function paint(status, stationName = '动物园', clock = '07:27') {
  const { g, ops } = stubCanvas(STATION_PLATE.width, STATION_PLATE.height)
  drawStationDisplay(g, status, stationName, clock)
  return { ops, words: ops.words.filter((w) => w.text.trim() !== '') }
}

test('a plate with no line bound prints the station, not a broken countdown', () => {
  const { words, ops } = paint(null)
  const texts = words.map((w) => w.text)
  assert.deepEqual(texts, ['动物园', '尚未铺设线路'], 'an unbound 电视 prints the station and says so')
  assert.ok(ops.fills > 0, 'and paints its own dark ground rather than nothing at all')
  for (const w of words) assert.equal(w.x, STATION_PLATE.width / 2, 'both lines are centred on the plate')
})

test('the plate prints the three services the headway derives', () => {
  // A train a minute out: the board reads 本趟 now, then the next two at the headway.
  const status = tvLineStatus(line(), [{ x: 10, y: 0.5, lineId: '5' }], [110, 0.5])
  const { words } = paint(status)
  const texts = words.map((w) => w.text)
  for (const label of ['本趟列车开往', '下趟列车开往', '第三趟列车开往']) {
    assert.ok(texts.includes(label), `${label} is one of the three cards`)
  }
  assert.equal(texts.filter((t) => t === '番禺广场').length, 3, 'every card prints the line’s terminus for its direction')
  const headway = Math.max(1, Math.round(status.headway))
  const next = status.minutes + headway
  assert.ok(texts.includes(`${next} 分钟`), `the second card counts down to ${next} 分钟`)
  assert.ok(texts.includes(`${next + headway} 分钟`), 'and the third one headway later')
  const strap = words.find((w) => w.text === '即将进站')
  assert.ok(strap, 'a train still approaching says so')
  assert.equal(strap.colour, '#1f7a4d', 'in the "on its way" green')
})

test('a train standing at the platform reads 列车进站, in the alarm colour', () => {
  const { words } = paint(tvLineStatus(line(), [{ x: 108, y: 0.5, lineId: '5' }], [110, 0.5]))
  const texts = words.map((w) => w.text)
  assert.ok(texts.includes('列车进站'), 'a berthed train is not "arriving"')
  assert.ok(!texts.includes('即将进站'), 'and it does not read as still on its way')
  assert.equal(words.find((w) => w.text === '列车进站').colour, '#c0392b', 'the strap turns the alarm red')
})

test('the board falls back to the headway when nothing is in the approach window', () => {
  const { words } = paint(tvLineStatus(line(), [], [110, 0.5]))
  const texts = words.map((w) => w.text)
  assert.ok(texts.includes('4 分钟'), 'with no countdown the second card prints one headway out')
  assert.ok(texts.includes('8 分钟'), 'and the third two headways out')
})

test('the header prints the line’s number and the station, and the shield wears the line colour', () => {
  const { words, ops } = paint(tvLineStatus(line(), [], [110, 0.5]))
  const texts = words.map((w) => w.text)
  assert.ok(texts.includes('5'), 'the shield prints the line number, not 5号线')
  assert.ok(!texts.includes('5号线'), 'the 号线 suffix is stripped for the roundel')
  assert.ok(texts.includes('动物园'), 'and the station name sits beside it')
  assert.ok(ops.filled.includes('#c8102e'), 'the shield is filled in the line’s own colour')
})

test('every word a line-bound plate prints stays in the station column, off the artwork', () => {
  // The layout test above pins the rectangles; this pins the ink. The window is the
  // network feed's half of the screen, so a word that reaches into it is a word the
  // artwork paints over. A plate with **no** line bound is the exception on purpose:
  // there is no feed to protect, so it centres the station name on the whole screen.
  const { poster } = stationDisplayLayout()
  const bound = [tvLineStatus(line(), [], [110, 0.5]), tvLineStatus(line(), [{ x: 10, y: 0.5, lineId: '5' }], [110, 0.5])]
  for (const status of bound) {
    for (const w of paint(status).words) {
      assert.ok(w.x <= poster.x + 0.5, `"${w.text}" was drawn at x=${w.x}, past the window at ${poster.x}`)
    }
  }
  assert.ok(paint(null).words.every((w) => w.x === STATION_PLATE.width / 2), 'and the unbound plate centres instead')
})

test('the clock prints under its own label, right-aligned inside the column', () => {
  const { words } = paint(tvLineStatus(line(), [], [110, 0.5]), '动物园', '07:27')
  const label = words.find((w) => w.text === '发车时间')
  const time = words.find((w) => w.text === '07:27')
  assert.ok(label && time, 'the clock is a label and a time, both printed')
  const clock = stationDisplayLayout().clock
  assert.ok(time.y >= clock.y && time.y <= clock.y + clock.h, 'the time sits in the clock box')
  // The time is placed behind the label it measured, so the two can never overlap —
  // and both are right-aligned to the column, whose right edge is the window's left.
  const probe = stubCanvas()
  probe.g.font = '18px x'
  assert.equal(time.x, label.x - probe.g.measureText('发车时间').width - 12, 'the time clears the label it measured')
  assert.ok(time.x <= stationDisplayLayout().poster.x, 'and neither runs into the artwork')
})

