// The site's demo picker (two entry points, one dialog) and the previews it shows.
// `web/` has no test runner of its own, so its wiring is pinned here as source
// contracts — the same way the game's React views are, since the Node suite does
// not mount either app.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { demoPath, stations } from '../../web/src/stations.js'
import { ui } from '../../web/src/i18n.js'

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')

test('the site offers exactly the game\'s two example stations', () => {
  const previews = readdirSync(new URL('../../game/src/assets/stations/', import.meta.url))
    .filter((f) => f.endsWith('.webp'))
    .sort()
  assert.deepEqual(stations.map((s) => s.preview).sort(), previews)
  assert.deepEqual(stations.map((s) => s.id), ['zoo', 'tanwei'])
})

test('a demo link is the game route, with the language pin in front', () => {
  assert.equal(demoPath('zh', 'zoo'), 'zoo')
  assert.equal(demoPath('zh', 'tanwei'), 'tanwei')
  assert.equal(demoPath('en', 'zoo'), 'en/zoo')
  assert.equal(demoPath('en', 'tanwei'), 'en/tanwei')
  const site = read('web/src/site.js')
  assert.match(site, /demoHref = \(lang, id\) => .*gameRoot.*demoPath\(lang, id\)/, 'the game root owns the href')
})

test('the game previews are published by the site build', () => {
  const sync = read('web/scripts/sync-stations.mjs')
  assert.match(sync, /'game',\s*'src',\s*'assets',\s*'stations'/, 'the game owns the pictures')
  assert.match(sync, /public',\s*'stations'/, 'they land in the site\'s public folder')
  const pkg = JSON.parse(read('web/package.json'))
  for (const script of ['predev', 'prebuild']) {
    assert.match(pkg.scripts[script], /sync-stations/, `${script} publishes them`)
  }
})

test('both buttons open the picker, and a card links a demo route', () => {
  const picker = read('web/src/components/DemoPicker.jsx')
  assert.match(picker, /role="dialog"/)
  assert.match(picker, /demoHref\(lang, station\.id\)/, 'cards link the game own route')
  assert.match(picker, /stationPreview\(station\.preview\)/, 'cards show the game own render')
  assert.match(read('web/src/components/Nav.jsx'), /onOpenDemos/)
  assert.match(read('web/src/components/Hero.jsx'), /onOpenDemos/)
  const app = read('web/src/App.jsx')
  assert.match(app, /<DemoPicker/)
  assert.match(app, /onOpenDemos=\{openDemos\}/)
})

test('the picker copy exists in both languages', () => {
  for (const lang of ['zh', 'en']) {
    for (const key of ['title', 'intro', 'close']) assert.ok(ui[lang].demos[key].trim(), `${lang}.demos.${key}`)
    for (const station of stations) {
      const copy = ui[lang].demos[station.id]
      assert.ok(copy.name.trim() && copy.line.trim() && copy.note.trim(), `${lang}.demos.${station.id}`)
    }
    assert.ok(ui[lang].nav.demos.trim(), `${lang}.nav.demos`)
    assert.ok(ui[lang].hero.demos.trim(), `${lang}.hero.demos`)
  }
  assert.equal(ui.zh.demos.zoo.name, '动物园', 'authored station names stay as the game prints them')
  assert.equal(ui.zh.demos.tanwei.name, '坦尾')
})
