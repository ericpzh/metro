import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const presenterCs = path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Runtime', 'App', 'StationDesktopUiPresenter.cs')
const presenterMeta = `${presenterCs}.meta`
const editorOverlayCs = path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Editor', 'StationEditorReactOverlay.cs')
const editorOverlayMeta = `${editorOverlayCs}.meta`
const hostDir = path.join(repoRoot, 'tools', 'unity-editor-ui')
const hostCsproj = path.join(hostDir, 'MetroEditorWebView.csproj')
const hostProgramCs = path.join(hostDir, 'Program.cs')
const uiManifest = path.join(repoRoot, 'game', 'dist-unity-ui', '.vite', 'manifest.json')

const STATUS_DLL_INIT_FAILURE = 0xc0000142

test('In-canvas React UI presenter and Windows .exe postprocessor keep paired .meta, smoke suppression and non-TOPMOST offscreen capture', () => {
  assert.equal(existsSync(presenterCs), true, 'StationDesktopUiPresenter.cs must exist in Runtime/App/')
  assert.equal(existsSync(presenterMeta), true, 'StationDesktopUiPresenter.cs.meta must be tracked alongside script')
  assert.equal(existsSync(editorOverlayCs), true, 'StationEditorReactOverlay.cs must exist in Editor/')
  assert.equal(existsSync(editorOverlayMeta), true, 'StationEditorReactOverlay.cs.meta must be tracked alongside script')

  const presenterSource = readFileSync(presenterCs, 'utf8')
  assert.match(presenterSource, /UNITY_STANDALONE_WIN\s*\|\|\s*UNITY_EDITOR_WIN/)
  assert.match(presenterSource, /RenderMode\.ScreenSpaceOverlay/)
  assert.match(presenterSource, /RawImage/)
  assert.match(presenterSource, /MemoryMappedFile/)
  assert.match(presenterSource, /LoadRawTextureData/)
  assert.match(presenterSource, /StationGameHost/)
  assert.match(presenterSource, /BrowserCommand/)
  assert.match(presenterSource, /ReplyPublished/)
  assert.match(presenterSource, /SmokeSuppressed/)
  assert.match(presenterSource, /streamingAssetsPath/)

  const editorSource = readFileSync(editorOverlayCs, 'utf8')
  assert.match(editorSource, /\[InitializeOnLoad\]/)
  assert.match(editorSource, /IPostprocessBuildWithReport/)
  assert.match(editorSource, /BuildTarget\.StandaloneWindows64/)
  assert.match(editorSource, /StreamingAssets/)
  assert.match(editorSource, /StationDesktopUiPresenter/)
  assert.match(editorSource, /SmokeSuppressed/)
  assert.match(editorSource, /Play StationGame with Full UI/)
  assert.match(editorSource, /Play StationGameLocal \(3D Crowd\) with Full UI/)

  const hostSource = readFileSync(hostProgramCs, 'utf8')
  assert.match(hostSource, /CreateCoreWebView2CompositionControllerAsync/)
  assert.match(hostSource, /DefaultBackgroundColor\s*=\s*Color\.Transparent/)
  assert.match(hostSource, /CreateFromVisual/)
  assert.match(hostSource, /CreateFreeThreaded/)
  assert.match(hostSource, /MemoryMappedFile/)
  assert.doesNotMatch(hostSource, /HWND_TOPMOST/, 'offscreen worker must never create a floating TOPMOST OS window')
  assert.match(hostSource, /html\.metro-overlay \.stage/)
  assert.match(hostSource, /html\.metro-overlay #unity-canvas/)
  assert.match(hostSource, /background:\s*transparent\s*!important/)
  assert.match(hostSource, /mountUnityUI/)
  assert.match(hostSource, /stationBridge\.register/)

  if (existsSync(uiManifest)) {
    const manifest = JSON.parse(readFileSync(uiManifest, 'utf8'))
    const entry = manifest['src/unity-web/main.tsx']
    assert.ok(entry?.file, 'dist-unity-ui manifest must expose src/unity-web/main.tsx entry')
    assert.ok(existsSync(path.join(repoRoot, 'game', 'dist-unity-ui', entry.file)), 'built entry chunk must exist on disk')
  }
})

test('MetroEditorWebView builds cleanly and captures 32-bit transparent React UI frames offscreen on interactive Windows desktops', { skip: process.platform !== 'win32' }, t => {
  const testBinDir = path.join(repoRoot, '.preview', 'unity', 'editor-ui-host', `test-bin-${process.pid}`)
  const testExe = path.join(testBinDir, 'MetroEditorWebView.exe')
  const reportPath = path.join(repoRoot, '.preview', 'unity', 'editor-ui-host', `selftest-${process.pid}.json`)
  rmSync(testBinDir, { recursive: true, force: true })
  rmSync(reportPath, { force: true })

  try {
    const build = spawnSync('dotnet', ['build', hostCsproj, '-c', 'Release', '-o', testBinDir, '--nologo', '-v', 'q'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    assert.equal(build.status, 0, `dotnet build failed:\n${build.stdout}\n${build.stderr}`)
    assert.equal(existsSync(testExe), true, 'MetroEditorWebView.exe must build cleanly')

    if (!existsSync(uiManifest)) {
      t.skip('game/dist-unity-ui not built yet')
      return
    }

    const run = spawnSync(testExe, ['--self-test', '--self-test-out', reportPath, '--repo', repoRoot], {
      cwd: repoRoot,
      timeout: 25000,
      encoding: 'utf8',
    })
    if ((run.status >>> 0) === STATUS_DLL_INIT_FAILURE) {
      t.skip('Current runner has no interactive Win32 window station (0xC0000142)')
      return
    }
    assert.equal(run.status, 0, `MetroEditorWebView --self-test failed (${run.status}):\n${run.stdout}\n${run.stderr}`)
    assert.equal(existsSync(reportPath), true, 'self-test JSON report must be written')
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.mounted, true)
    assert.equal(report.transparent, true)
    assert.equal(report.offscreen, true)
    assert.equal(report.inputForwarded, true)
  } finally {
    rmSync(reportPath, { force: true })
    rmSync(testBinDir, { recursive: true, force: true })
  }
})
