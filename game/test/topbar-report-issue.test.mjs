import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = (path) => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('settings uses matching square tiles for controls and outbound actions', () => {
  const topBar = source('app/windows/topbar/SettingsMenu.tsx')
  const music = source('app/windows/topbar/MusicSetting.tsx')
  assert.match(source('app/windows/topbar/TopBar.tsx'), /<SettingsMenu \/>/)
  const messages = source('sim/i18n/messages.ts')
  const css = source('styles.css')

  assert.match(topBar, /import \{ FaBug \} from 'react-icons\/fa'/, 'the tracker icon is FaBug from react-icons/fa')
  assert.match(topBar, /<FaBug aria-hidden="true" \/>/, 'the bug glyph is decorative inside a labelled link')
  assert.match(topBar, /import \{ reportIssueHrefFor \} from '\.\.\/\.\.\/reportIssueRoute\.ts'/, 'the link uses the stats report route helper')
  assert.match(topBar, /href=\{reportIssueHrefFor\(language, Boolean\(import\.meta\.env\?\.DEV\)\)\}/, 'the link follows the active language and local stats Worker in dev')
  assert.match(topBar, /target="_blank"/, 'the tracker opens in a new tab so the open station stays put')
  assert.match(topBar, /rel="noopener noreferrer"/, 'the new tab cannot reach its opener')
  assert.match(topBar, /title=\{t\('report_issue'\)\}/, 'the hover text reads the bilingual catalogue key')
  assert.match(topBar, /aria-label=\{t\('report_issue'\)\}/, 'the accessible name reads the bilingual catalogue key, not hardcoded English')
  assert.match(topBar, /className="settingsToggleGrid"/)
  assert.match(topBar, /className="settingsActionGrid"/)
  for (const icon of ['PiHighDefinition', 'PiGraphicsCard', 'CgScrollV', 'TbWorldUpload', 'FaPalette']) {
    assert.match(topBar, new RegExp(`<${icon} aria-hidden="true"\\s*\/>`), `${icon} decorates its labelled tile`)
  }
  assert.match(topBar, /setUiTheme\(uiThemes\[\(uiThemes.indexOf\(theme\) \+ 1\) % uiThemes.length\]\)/)
  assert.match(topBar, /graphics_high_short/)
  assert.match(css, /\.settingsToggleGrid \{ display: grid; grid-template-columns: repeat\(4/)
  assert.match(css, /\.settingsActionGrid \{ display: grid; grid-template-columns: repeat\(4/)
  assert.match(music, /setCreditsDismissed\(true\);gameMusic\.toggle\(\)/, 'play or pause dismisses music credits')
  assert.match(css, /\.settingsMusic:hover>\.musicCreditsPanel\{display:block\}/)
  assert.doesNotMatch(css, /\.settingsMusic:focus-within>\.musicCreditsPanel/)
  assert.match(css, /\.settingsMusic\.creditsDismissed>\.musicCreditsPanel\{display:none\}/)
  assert.match(css, /a\.ghost \{/, 'the transparent button styling applies to anchors, or the link renders as default blue text')
  assert.match(messages, /"report_issue": \{\s*"zh": "报告问题",\s*"en": "Report issue"\s*\}/, 'both locales name the tracker action')
})
