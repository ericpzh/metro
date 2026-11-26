import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSaveFileName,
  getDesktopFileBridge,
  openDesktopSaveFile,
  saveDesktopSaveFile,
} from '../../game/src/unity-web/desktopFiles.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('getDesktopFileBridge returns null on WebGL and returns bridge when both methods exist', () => {
  assert.equal(getDesktopFileBridge({}), null)
  assert.equal(getDesktopFileBridge({ __metroDesktopFiles: { openSave: () => {} } }), null)
  const bridge = {
    openSave: async () => ({ ok: true, text: '{}' }),
    saveFile: async () => ({ ok: true }),
  }
  assert.equal(getDesktopFileBridge({ __metroDesktopFiles: bridge }), bridge)
})

test('openDesktopSaveFile opens committed save text, stays silent on cancel, and reports errors', async () => {
  const calls = []
  let opened = null
  let errors = 0

  const ok = await openDesktopSaveFile(
    {
      openSave: async opts => {
        calls.push(opts)
        return { ok: true, text: '{"version":1}' }
      },
      saveFile: async () => ({ ok: true }),
    },
    {
      english: true,
      onOpen: text => { opened = text },
      onError: () => { errors++ },
    },
  )
  assert.equal(ok, true)
  assert.equal(opened, '{"version":1}')
  assert.equal(errors, 0)
  assert.equal(calls[0].title, 'Open Station Save')

  opened = null
  const cancelled = await openDesktopSaveFile(
    {
      openSave: async () => ({ ok: false, cancelled: true }),
      saveFile: async () => ({ ok: true }),
    },
    {
      english: false,
      onOpen: text => { opened = text },
      onError: () => { errors++ },
    },
  )
  assert.equal(cancelled, false)
  assert.equal(opened, null)
  assert.equal(errors, 0)

  const failed = await openDesktopSaveFile(
    {
      openSave: async () => ({ ok: false, error: 'disk error' }),
      saveFile: async () => ({ ok: true }),
    },
    {
      english: false,
      onOpen: text => { opened = text },
      onError: () => { errors++ },
    },
  )
  assert.equal(failed, false)
  assert.equal(errors, 1)
})

test('saveDesktopSaveFile passes sanitized filename and only marks saved on confirmation', async () => {
  assert.equal(buildSaveFileName('动物园 / Zoo'), '动物园-Zoo.metro.json')
  assert.equal(buildSaveFileName('   '), 'station.metro.json')

  const calls = []
  let saved = 0
  let errors = 0
  const ok = await saveDesktopSaveFile(
    {
      openSave: async () => ({ ok: false, cancelled: true }),
      saveFile: async opts => {
        calls.push(opts)
        return { ok: true, path: 'C:\\saves\\zoo.metro.json' }
      },
    },
    {
      english: false,
      stationName: '动物园',
      docText: '{"version":1}',
      onSaved: () => { saved++ },
      onError: () => { errors++ },
    },
  )
  assert.equal(ok, true)
  assert.equal(saved, 1)
  assert.equal(errors, 0)
  assert.equal(calls[0].suggestedName, '动物园.metro.json')
  assert.equal(calls[0].text, '{"version":1}')

  const cancelled = await saveDesktopSaveFile(
    {
      openSave: async () => ({ ok: false, cancelled: true }),
      saveFile: async () => ({ ok: false, cancelled: true }),
    },
    {
      english: true,
      stationName: 'Zoo',
      docText: '{}',
      onSaved: () => { saved++ },
      onError: () => { errors++ },
    },
  )
  assert.equal(cancelled, false)
  assert.equal(saved, 1)
  assert.equal(errors, 0)
})

test('Desktop WebView2 host, Unity presenter, and TopBar wire native OpenFileDialog and SaveFileDialog cleanly', () => {
  const hostSource = readFileSync(path.join(repoRoot, 'tools', 'unity-editor-ui', 'Program.cs'), 'utf8')
  const presenterSource = readFileSync(
    path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Runtime', 'App', 'StationDesktopUiPresenter.cs'),
    'utf8',
  )
  const topBarSource = readFileSync(
    path.join(repoRoot, 'game', 'src', 'app', 'windows', 'topbar', 'TopBar.tsx'),
    'utf8',
  )

  assert.match(hostSource, /__metro_file_open__:/)
  assert.match(hostSource, /__metro_file_save__:/)
  assert.match(hostSource, /__metro_file_reply__:/)
  assert.match(hostSource, /window\.__metroDesktopFiles\s*=/)
  assert.match(hostSource, /new OpenFileDialog\b/)
  assert.match(hostSource, /new SaveFileDialog\b/)
  assert.match(hostSource, /ResolveUnityOwnerHwnd\(\)/)
  assert.match(hostSource, /ApartmentState\.STA/)
  assert.match(hostSource, /kind = "modalDialog"/)
  assert.match(hostSource, /if \(Volatile\.Read\(ref nativeDialogActive\) != 0\) break;/)

  assert.match(presenterSource, /AllowSetForegroundWindow/)
  assert.match(presenterSource, /case "modalDialog":/)
  assert.match(presenterSource, /nativeModalDialogOpen/)

  assert.match(topBarSource, /if \(files\?\.pickOpen\)/)
})
