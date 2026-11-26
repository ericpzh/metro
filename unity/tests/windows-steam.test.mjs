import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  loadSteamConfig,
  renderAppBuildVdf,
  renderDepotBuildVdf,
  renderWebView2InstallScriptVdf,
  STEAM_CLOUD_PATTERN,
  STEAM_CLOUD_ROOT,
  STEAM_COMPANY_NAME,
} from '../../tools/unity-web/pack-windows-steam.mjs'
import { buildSteamCmdArgs } from '../../tools/unity-web/deploy-steam.mjs'

const repo = resolve(import.meta.dirname, '../..')

test('Unity ProjectSettings locks companyName Erikaze and bundleVersion 0.1.0 for stable Steam Cloud save paths', () => {
  const settings = readFileSync(join(repo, 'unity/ProjectSettings/ProjectSettings.asset'), 'utf8')
  assert.match(settings, /^\s*companyName:\s*Erikaze\s*$/m)
  assert.match(settings, /^\s*bundleVersion:\s*0\.1\.0\s*$/m)
  assert.equal(STEAM_COMPANY_NAME, 'Erikaze')
  assert.equal(STEAM_CLOUD_ROOT, 'WinAppDataLocalLow/Erikaze/Station Designer')
  assert.equal(STEAM_CLOUD_PATTERN, '*.metro.json')
})

test('loadSteamConfig succeeds with null IDs when no local config exists and reads JSON + CLI overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metro-steam-cfg-'))
  try {
    const empty = loadSteamConfig(dir)
    assert.equal(empty.appId, null)
    assert.equal(empty.depotId, null)
    assert.equal(empty.sourcePath, null)

    const file = join(dir, 'steam-config.json')
    writeFileSync(
      file,
      JSON.stringify({
        appId: 1234560,
        depotId: 1234561,
        description: 'Station Designer EA',
        setLive: 'beta',
        requireSteamRestart: true,
      }),
      'utf8',
    )
    const loaded = loadSteamConfig(dir, { configPath: file, setLive: 'staging' })
    assert.equal(loaded.appId, 1234560)
    assert.equal(loaded.depotId, 1234561)
    assert.equal(loaded.description, 'Station Designer EA')
    assert.equal(loaded.setLive, 'staging')
    assert.equal(loaded.requireSteamRestart, true)

    assert.throws(
      () => loadSteamConfig(dir, { appId: '1234560' }),
      /requires both appId and depotId/,
    )
    assert.throws(
      () => loadSteamConfig(dir, { appId: 'abc', depotId: '123' }),
      /Invalid Steam appId/,
    )

    const badFile = join(dir, 'steam-bad.json')
    writeFileSync(badFile, JSON.stringify({ appId: 480, depotId: 481, password: 'secret' }), 'utf8')
    assert.throws(
      () => loadSteamConfig(dir, { configPath: badFile }),
      /Do not store Steam passwords/,
    )

    const cmdArgs = buildSteamCmdArgs({ steamUser: 'erikaze_builder', appVdfPath: join(dir, 'app_build_480.vdf') })
    assert.deepEqual(cmdArgs, ['+login', 'erikaze_builder', '+run_app_build', resolve(join(dir, 'app_build_480.vdf')), '+quit'])
    assert.throws(() => buildSteamCmdArgs({ steamUser: '', appVdfPath: 'app.vdf' }), /Missing Steam build account username/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Steam release directory steam/ is gitignored except README and placeholder example config', () => {
  const gitignore = readFileSync(join(repo, '.gitignore'), 'utf8')
  assert.match(gitignore, /^\/steam\/\*\s*$/m)
  assert.match(gitignore, /^!\/steam\/README\.md\s*$/m)
  assert.match(gitignore, /^!\/steam\/steam-config\.example\.json\s*$/m)
  const example = JSON.parse(readFileSync(join(repo, 'steam/steam-config.example.json'), 'utf8'))
  assert.equal(example.appId, 480)
  assert.equal(example.depotId, 481)
})

test('renderDepotBuildVdf and renderAppBuildVdf emit valid SteamPipe KeyValues excluding non-shippable files', () => {
  const depotVdf = renderDepotBuildVdf({
    depotId: 1234561,
    contentRoot: 'C:\\repo\\steam\\depot',
  })
  assert.match(depotVdf, /"DepotID"\s+"1234561"/)
  assert.match(depotVdf, /"ContentRoot"\s+"C:\\\\repo\\\\steam\\\\depot"/)
  assert.match(depotVdf, /"FileExclusion"\s+"\*\.pdb"/)
  assert.match(depotVdf, /"FileExclusion"\s+"steam_appid\.txt"/)
  assert.match(depotVdf, /"FileExclusion"\s+"\*_BackUpThisFolder_ButDontShipItWithYourGame\/\*"/)

  const appVdf = renderAppBuildVdf({
    appId: 1234560,
    depotId: 1234561,
    depotVdfPath: 'depot_build_1234561.vdf',
    contentRoot: 'C:\\repo\\steam\\depot',
    buildOutput: 'C:\\repo\\steam\\pipe\\output',
    description: 'Station Designer "0.1.0"',
    setLive: 'beta',
  })
  assert.match(appVdf, /"AppID"\s+"1234560"/)
  assert.match(appVdf, /"Desc"\s+"Station Designer \\"0\.1\.0\\""/)
  assert.match(appVdf, /"SetLive"\s+"beta"/)
  assert.match(appVdf, /"1234561"\s+"depot_build_1234561\.vdf"/)

  const installVdf = renderWebView2InstallScriptVdf()
  assert.match(installVdf, /"InstallScript"/)
  assert.match(installVdf, /MicrosoftEdgeWebview2Setup\.exe/)
  assert.match(installVdf, /\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5\}/)
})

test('StationSteamHost uses Steamworks SDK 1.65 flat C ABI gated on steam_api64.dll and wires overlay pause into StationDesktopUiPresenter', () => {
  const steamHost = readFileSync(join(repo, 'unity/Assets/StationDesigner/Runtime/App/StationSteamHost.cs'), 'utf8')
  assert.match(steamHost, /#if UNITY_STANDALONE_WIN && !UNITY_EDITOR/)
  assert.match(steamHost, /GameOverlayActivatedCallbackId = 331/)
  assert.match(steamHost, /HasBundledSteamApiDll/)
  assert.match(steamHost, /SteamAPI_InitFlat/)
  assert.match(steamHost, /SteamAPI_RestartAppIfNecessary/)
  assert.match(steamHost, /SteamAPI_ManualDispatch_GetNextCallback/)
  assert.match(steamHost, /SteamAPI_ISteamApps_GetCurrentGameLanguage/)

  const presenter = readFileSync(join(repo, 'unity/Assets/StationDesigner/Runtime/App/StationDesktopUiPresenter.cs'), 'utf8')
  assert.match(presenter, /StationSteamHost\.IsOverlayActive/)
  assert.match(presenter, /StationSteamHost\.OverlayActiveChanged/)
  assert.match(presenter, /StationSteamHost\.TryResolveStartupLanguage/)
})
