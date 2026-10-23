// The top-bar play/pause button resumes like Space (`AppShell.tsx`).
//
// The segmented group is (暂停 | 1× | 4× | 16× | 64×): paused highlights the
// play icon, playing highlights the active speed (§9.6C playback). Space
// toggles `playing`, so a paused click on the play icon must resume at the
// kept speed — the old handler only paused (`if (playing) setPlaying(false)`)
// and a paused station could never be resumed from the button itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = (path) => fs.readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('the paused play button resumes like Space', () => {
  const topBar = source('app/windows/topbar/SimulationControls.tsx')
  const shell = source('app/windows/AppShell.tsx')

  assert.match(shell, /st\.setPlaying\(!st\.playing\)/, 'Space toggles play/pause, keeping the last speed')
  assert.match(topBar, /setPlaying\(!playing\)/, 'the play/pause button toggles the same way, so a paused click resumes')
  assert.doesNotMatch(
    topBar,
    /if \(playing\) setPlaying\(false\)/,
    'a pause-only handler leaves a paused station with no button to resume it',
  )
  assert.match(
    topBar,
    /if \(!state.playing\) state.setPlaying\(true\)/,
    'the speed tiles still resume at their own speed when paused',
  )
})
