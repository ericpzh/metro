// Contract tests for Windows IME (Chinese/CJK input) synchronization between the
// offscreen WebView2 host (`tools/unity-editor-ui/Program.cs`) and Unity's
// `StationDesktopUiPresenter` (`Keyboard.SetIMEEnabled` / `SetIMECursorPosition` /
// `onIMECompositionChange`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')

test('MetroEditorWebView tracks focused HTML text inputs and forwards IME focus + anchor coordinates', () => {
  const hostSource = readFileSync(join(repoRoot, 'tools/unity-editor-ui/Program.cs'), 'utf8')
  assert.match(hostSource, /const isImeTextInput = \(el\) =>/)
  assert.match(hostSource, /__metro_ime__:/)
  assert.match(hostSource, /window\.addEventListener\('focusin', syncImeNow, true\)/)
  assert.match(hostSource, /window\.addEventListener\('focusout', scheduleImeSync, true\)/)
  assert.match(hostSource, /document\.addEventListener\('selectionchange', scheduleImeSync\)/)
  assert.match(hostSource, /scheduleImeSync\(\);/)
  assert.match(hostSource, /kind = "ime", enabled, x, y/)
  assert.match(hostSource, /Input\.insertText/)
})

test('StationDesktopUiPresenter keeps system IME permanently enabled, never forces English, positions candidates, and suppresses composing/commit raw keys in inputs', () => {
  const presenterSource = readFileSync(
    join(repoRoot, 'unity/Assets/StationDesigner/Runtime/App/StationDesktopUiPresenter.cs'),
    'utf8',
  )
  assert.match(presenterSource, /case "ime":/)
  assert.match(presenterSource, /RuntimeInitializeLoadType\.BeforeSplashScreen\)\][\s\S]*?UnityEngine\.Input\.imeCompositionMode = IMECompositionMode\.On/)
  assert.match(presenterSource, /EnableIMECompositionCommand\.Create\(true\)/)
  assert.doesNotMatch(presenterSource, /SetIMEEnabled\(false\)/)
  assert.doesNotMatch(presenterSource, /\b(?:ImmAssociateContext(?:Ex)?|SetFocus|ImmSetOpenStatus|ImmSetConversionStatus)\(/)
  assert.match(presenterSource, /kb\.SetIMECursorPosition\(pos\)/)
  assert.match(presenterSource, /ImmSetCompositionWindow\(himc, ref comp\)/)
  assert.match(presenterSource, /ImmSetCandidateWindow\(himc, ref cand\)/)
  assert.match(presenterSource, /ImmNotifyIME\(himc, NiCompositionStr, CpsCancel, 0\)/)
  assert.match(presenterSource, /onIMECompositionChange \+= OnImeCompositionChanged/)
  assert.match(presenterSource, /ShouldSuppressKeyDuringIme\(/)
  assert.match(presenterSource, /char\.IsHighSurrogate\(ch\)/)
  assert.match(presenterSource, /"insertText"/)
})
