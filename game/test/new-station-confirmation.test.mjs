import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = (path) => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('the shared station-replacement confirmation dialog is accessible and warns players to save', () => {
  const dialog = source('app/windows/topbar/ReplaceStationDialog.tsx')

  assert.match(dialog, /role="dialog"[\s\S]{0,80}aria-modal="true"/, 'the prompt is an accessible modal dialog')
  assert.match(dialog, /t\('the_current_station_will_be_replaced_save_anything_you_want_to_k'\)/, 'the warning tells players to save without promising undo')
  assert.match(dialog, /onClick=\{onCancel\}>\{t\('cancel'\)\}/, 'the dialog offers cancellation')
  assert.match(dialog, /onClick=\{onConfirm\}>\{confirmLabel\}/, 'the replacement action is an explicit choice')
  assert.match(dialog, /if \(e\.key === 'Escape'\)[\s\S]{0,120}onCancelRef\.current\(\)/, 'Escape dismisses the prompt')
  assert.match(dialog, /e\.target === e\.currentTarget\) onCancel\(\)/, 'clicking the backdrop dismisses the prompt')
})

test('the new-station button and Ctrl+N ask for confirmation before replacing the station', () => {
  const button = source('app/windows/topbar/NewStationButton.tsx')
  const shell = source('app/windows/AppShell.tsx')
  const topBar = source('app/windows/topbar/TopBar.tsx')

  assert.match(topBar, /<NewStationButton\s*\/>/, 'the top-bar action uses the confirmation component')
  assert.match(shell, /ck === 'n'[\s\S]{0,100}metro:new-station/, 'Ctrl+N requests the same confirmation')
  assert.match(button, /addEventListener\('metro:new-station', show\)/, 'the component handles the shortcut event')
  assert.match(button, /<ReplaceStationDialog[\s\S]*title=\{t\('new_station'\)\}[\s\S]*confirmLabel=\{t\('new_station_483'\)\}/, 'New Station renders the shared confirmation dialog')
  // Only confirmation replaces the station. When the Unity host owns the document the
  // component asks the host (plan 11 A6); the TypeScript store keeps its own path.
  assert.match(button, /const confirm = \(\): void => \{\s*if \(host\) host\.newStation\(\); else newStation\(\)/, 'only confirmation runs the station replacement action, through the host when Unity owns the station')
})

test('loading an example station asks for confirmation before replacing the station in both web and Unity builds', () => {
  const examples = source('app/windows/topbar/ExampleStationsButton.tsx')
  const topBar = source('app/windows/topbar/TopBar.tsx')

  assert.match(topBar, /<ExampleStationsButton\s*\/>/, 'the top bar mounts the shared example stations control')
  assert.match(examples, /setPendingStation\(station\)/, 'clicking a demo card queues confirmation instead of replacing immediately')
  assert.doesNotMatch(examples, /className="exampleStationCard"[\s\S]{0,220}host\.openDemo/, 'clicking a demo card does not call host.openDemo directly')
  assert.doesNotMatch(examples, /className="exampleStationCard"[\s\S]{0,220}openExampleWithLoading/, 'clicking a demo card does not load the Three.js demo directly')
  assert.match(examples, /const confirm = \(\): void => \{[\s\S]*if \(host\) \{ host\.openDemo\(station\.id\); return \}[\s\S]*openExampleWithLoading/, 'only confirmation loads the demo via the Unity host or Three.js store')
  assert.match(examples, /<ReplaceStationDialog[\s\S]*t\('open_example_station_confirm_title'[\s\S]*confirmLabel=\{t\('open_example_station'\)\}/, 'Example Stations renders the shared confirmation dialog')
})

test('opening a save file via the toolbar button or Ctrl+L asks for confirmation before replacing the station', () => {
  const topBar = source('app/windows/topbar/TopBar.tsx')
  const shell = source('app/windows/AppShell.tsx')

  assert.match(shell, /ck === 'l'[\s\S]{0,100}metro:open/, 'Ctrl+L dispatches the shared open event')
  assert.match(topBar, /const open = \(\): void => setConfirmOpenSave\(true\)/, 'Ctrl+L opens the confirmation dialog instead of opening the file picker immediately')
  assert.match(topBar, /onOpen=\{\(\) => setConfirmOpenSave\(true\)\}/, 'the Open toolbar button opens the confirmation dialog')
  assert.match(topBar, /const confirmOpenSaveDialog = \(\): void => \{\s*setConfirmOpenSave\(false\)\s*(?:if \(files\?\.pickOpen\) \{\s*files\.pickOpen\(\)\s*return\s*\}\s*)?fileRef\.current\?\.click\(\)/, 'only confirmation triggers the file picker')
  assert.match(topBar, /<ReplaceStationDialog[\s\S]*open=\{confirmOpenSave\}[\s\S]*title=\{t\('open_save_confirm_title'\)\}[\s\S]*confirmLabel=\{t\('open_save_confirm'\)\}/, 'Open Save renders the shared confirmation dialog')
})
