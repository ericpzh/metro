import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = (path) => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('the new-station button and Ctrl+N ask for confirmation before replacing the station', () => {
  const button = source('app/windows/topbar/NewStationButton.tsx')
  const shell = source('app/windows/AppShell.tsx')
  const topBar = source('app/windows/topbar/TopBar.tsx')

  assert.match(topBar, /<NewStationButton\s*\/>/, 'the top-bar action uses the confirmation component')
  assert.match(shell, /ck === 'n'[\s\S]{0,100}metro:new-station/, 'Ctrl+N requests the same confirmation')
  assert.match(button, /addEventListener\('metro:new-station', show\)/, 'the component handles the shortcut event')
  assert.match(button, /role="dialog" aria-modal="true"/, 'the prompt is an accessible modal dialog')
  assert.match(button, /t\('the_current_station_will_be_replaced_save_anything_you_want_to_k'\)/, 'the warning tells players to save without promising undo')
  assert.match(button, /onClick=\{cancel\}>\{t\('cancel'\)\}/, 'the dialog offers cancellation')
  assert.match(button, /const confirm = \(\): void => \{\s*newStation\(\)/, 'only confirmation runs the station replacement action')
  assert.match(button, /onClick=\{confirm\}>\{t\('new_station_483'\)\}/, 'the replacement action is an explicit choice')
  assert.match(button, /if \(e\.key === 'Escape'\)[\s\S]{0,100}setOpen\(false\)/, 'Escape dismisses the prompt')
  assert.match(button, /e\.target === e\.currentTarget\) cancel\(\)/, 'clicking the backdrop dismisses the prompt')
})
