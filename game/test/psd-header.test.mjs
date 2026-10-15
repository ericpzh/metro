import test from 'node:test'
import assert from 'node:assert/strict'
import { psdHeaderInfo, drawPsdHeader } from '../src/render/models/pieces/PsdHeader.ts'
import { setLanguage } from '../src/sim/i18n.ts'

const line = { upTerminus: '文冲', downTerminus: '滘口' }
const edge = (dir, side) => ({ cfg: { dir, side } })

test('terminal signage matches only the platform direction, with no empty-name match', () => {
  for (const side of ['left', 'right']) {
    assert.equal(psdHeaderInfo(line, edge('up', side), ' 文冲 ').terminal, true)
    assert.equal(psdHeaderInfo(line, edge('down', side), '文冲').terminal, false)
    assert.equal(psdHeaderInfo(line, edge('down', side), '滘口').terminal, true)
    assert.equal(psdHeaderInfo(line, edge('up', side), '滘口').terminal, false)
    assert.equal(psdHeaderInfo(line, edge('up', side), '动物园').terminal, false)
    assert.equal(psdHeaderInfo(undefined, edge('up', side), '').terminal, false)
  }
})

test('arrows follow train travel as seen from either platform bank', () => {
  assert.equal(psdHeaderInfo(line, edge('up', 'left'), '').arrow, -1)
  assert.equal(psdHeaderInfo(line, edge('down', 'left'), '').arrow, 1)
  assert.equal(psdHeaderInfo(line, edge('up', 'right'), '').arrow, 1)
  assert.equal(psdHeaderInfo(line, edge('down', 'right'), '').arrow, -1)
})

function printed(kind, info) {
  const words = [], fills = [], lines = []
  const ctx = { fillStyle: '', font: '', textAlign: '',
    save() {}, restore() {}, beginPath() {}, stroke() {}, fill() {}, arc() {},
    measureText: () => ({ width: 100 }),
    fillRect: (...rect) => fills.push({ colour: ctx.fillStyle, rect }),
    fillText: (text, x, y) => words.push({ text, x, y, font: ctx.font }),
    moveTo: (x, y) => lines.push([x, y]), lineTo: (x, y) => lines.push([x, y]),
  }
  drawPsdHeader(ctx, kind, '#123456', info, '动物园', 'Zoo')
  return { words, fills, lines }
}

test('physical panels keep bilingual station/terminal ink and destination on the travel side', () => {
  for (const lang of ['zh-CN', 'en']) {
    setLanguage(lang)
    for (const arrow of [-1, 1]) {
      const info = { arrow, terminal: false, destination: '文冲' }
      const station = printed('station', info)
      assert.deepEqual(station.words.map(w => w.text), ['动物园', 'Zoo', '文冲'])
      assert.ok((station.words[2].x - 512) * arrow > 0)
      assert.deepEqual(station.fills.find(f => f.colour === '#123456').rect, [0, 234, 1024, 22])
      const route = printed('route', info)
      assert.deepEqual(route.words.map(w => w.text), ['文冲'], 'schematic route invents no stop names')
      assert.ok(route.lines.some(([, y]) => y === 76))
      const terminal = printed('route', { ...info, terminal: true })
      assert.deepEqual(terminal.words.map(w => w.text), ['终点站', 'Terminal'])
      assert.equal(terminal.lines.length, 0, 'terminal replaces the route drawing')
    }
  }
  setLanguage('zh-CN')
})
