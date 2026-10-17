import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = (path) => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('the top-bar settings links the issue tracker beside restart', () => {
  const topBar = source('app/windows/topbar/SettingsMenu.tsx')
  assert.match(source('app/windows/topbar/TopBar.tsx'), /<SettingsMenu \/>/)
  const messages = source('sim/i18n/messages.ts')
  const css = source('styles.css')

  assert.match(topBar, /import \{ FaBug \} from 'react-icons\/fa'/, 'the tracker icon is FaBug from react-icons/fa')
  assert.match(topBar, /<FaBug aria-hidden="true" \/>/, 'the bug glyph is decorative inside a labelled link')
  assert.match(topBar, /href="https:\/\/github\.com\/ericpzh\/metro\/issues"/, 'the link opens the repo issue tracker, not a hardcoded mirror')
  assert.match(topBar, /target="_blank"/, 'the tracker opens in a new tab so the open station stays put')
  assert.match(topBar, /rel="noreferrer"/, 'the outbound link carries no opener')
  assert.match(topBar, /title=\{t\('report_issue'\)\}/, 'the hover text reads the bilingual catalogue key')
  assert.match(topBar, /aria-label=\{t\('report_issue'\)\}/, 'the accessible name reads the bilingual catalogue key, not hardcoded English')
  assert.match(
    topBar,
    /aria-label=\{t\('restart'\)\}[\s\S]*metro\/issues[\s\S]*setLanguage/,
    'the tracker link sits between the restart button and the language switch',
  )
  assert.match(topBar, /<a[\s\S]*?className="ghost settingsAction"[\s\S]*?metro\/issues/, 'the link wears the settings row chrome')
  assert.match(css, /a\.ghost \{/, 'the transparent button styling applies to anchors, or the link renders as default blue text')
  assert.match(messages, /"report_issue": \{\s*"zh": "报告问题",\s*"en": "Report issue"\s*\}/, 'both locales name the tracker action')
})
