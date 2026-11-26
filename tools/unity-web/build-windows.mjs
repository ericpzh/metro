// Isolated Windows Standalone (.exe) builder for Station Designer.
//
// Syncs unity/ into .preview/unity/win-workspace/project (leaving the live
// Unity Editor and WebGL dev-workspace untouched), rebuilds MetroEditorWebView
// and game/dist-unity-ui, switches the isolated workspace to Win64, and builds
// MetroStation.exe via unity/scripts/metro-unity.ps1 build-windows.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { packWindowsExe } from './pack-windows-exe.mjs'
import { packWindowsMsix } from './pack-windows-msix.mjs'
import { packWindowsSteam } from './pack-windows-steam.mjs'

const repo = resolve(import.meta.dirname, '../..')
const unityDir = join(repo, 'unity')
const workspace = join(repo, '.preview/unity/win-workspace')
const projectDir = join(workspace, 'project')

const args = process.argv.slice(2)
let configuration = 'Release'
let outDir = ''
let noPassengers = false
let buildMsix = false
let buildSteam = false
let noBundle = false
let version = ''
let msixIdentity = ''
let devSign = false
let steamConfig = ''
let steamAppId = ''
let steamDepotId = ''
let steamSetLive = ''
let steamDescription = ''
let steamSdkPath = ''
let steamRequireRestart = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--configuration' && i + 1 < args.length) configuration = args[++i]
  else if (args[i] === '--out' && i + 1 < args.length) outDir = resolve(repo, args[++i])
  else if (args[i] === '--no-passengers') noPassengers = true
  else if (args[i] === '--msix') buildMsix = true
  else if (args[i] === '--steam') buildSteam = true
  else if (args[i] === '--no-bundle') noBundle = true
  else if (args[i] === '--version' && i + 1 < args.length) version = args[++i]
  else if (args[i] === '--identity' && i + 1 < args.length) msixIdentity = args[++i]
  else if (args[i] === '--dev-sign') devSign = true
  else if (args[i] === '--steam-config' && i + 1 < args.length) steamConfig = args[++i]
  else if (args[i] === '--steam-sdk' && i + 1 < args.length) steamSdkPath = args[++i]
  else if (args[i] === '--app-id' && i + 1 < args.length) steamAppId = args[++i]
  else if (args[i] === '--depot-id' && i + 1 < args.length) steamDepotId = args[++i]
  else if (args[i] === '--set-live' && i + 1 < args.length) steamSetLive = args[++i]
  else if (args[i] === '--description' && i + 1 < args.length) steamDescription = args[++i]
  else if (args[i] === '--require-steam-restart') steamRequireRestart = true
  else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node tools/unity-web/build-windows.mjs [--configuration Release|Development] [--out .preview/unity/<dir>] [--no-passengers] [--msix [--version 1.0.0.0] [--identity <json>] [--dev-sign]] [--steam [--version 0.1.0] [--steam-config <json>] [--app-id <id> --depot-id <id>] [--set-live <branch>] [--require-steam-restart]] [--no-bundle]')
    process.exit(0)
  }
}
if (buildMsix && buildSteam) {
  throw new Error('Cannot combine --msix and --steam in the same invocation.')
}
// Public store builds (Microsoft Store MSIX & Steam depot) always ship the clean public scene
// without the portable SFX wrapper.
if (buildMsix || buildSteam) {
  noPassengers = true
  noBundle = true
}

if (!outDir) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)
  outDir = join(workspace, 'builds', `build-${stamp}`)
}

function run(cmd, cmdArgs, label, opts = {}) {
  console.log(`[unity-win] ${label}...`)
  const res = spawnSync(cmd, cmdArgs, { cwd: repo, stdio: 'inherit', shell: false, ...opts })
  if (res.error) throw res.error
  if ((res.status ?? 1) !== 0) throw new Error(`${label} failed with exit code ${res.status}`)
}

function robocopy(src, dst, flags) {
  mkdirSync(dst, { recursive: true })
  const res = spawnSync('robocopy', [src, dst, ...flags, '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (res.error) throw res.error
  if ((res.status ?? 16) >= 8) {
    throw new Error(`robocopy failed (${res.status}) copying ${src} -> ${dst}\n${res.stdout}\n${res.stderr}`)
  }
}

function resolveUnityEditor() {
  if (process.env.METRO_UNITY_EDITOR) return process.env.METRO_UNITY_EDITOR
  const pv = readFileSync(join(unityDir, 'ProjectSettings/ProjectVersion.txt'), 'utf8')
  const match = pv.match(/^m_EditorVersion:\s*(\S+)/m)
  if (!match) throw new Error('Could not read m_EditorVersion from unity/ProjectSettings/ProjectVersion.txt')
  return `C:/Program Files/Unity/Hub/Editor/${match[1]}/Editor/Unity.exe`
}

// 1. Rebuild WebView2 host + React UI bundle so StreamingAssets/MetroUi is always fresh.
run('dotnet', ['build', join(repo, 'tools/unity-editor-ui/MetroEditorWebView.csproj'), '-c', 'Release'], 'Building MetroEditorWebView.exe')
if (process.platform === 'win32') {
  run('cmd.exe', ['/d', '/s', '/c', 'npm --prefix game run build:unity-ui'], 'Building React UI bundle (game/dist-unity-ui)')
} else {
  run('npm', ['--prefix', 'game', 'run', 'build:unity-ui'], 'Building React UI bundle (game/dist-unity-ui)')
}

// 2. Sync unity/ sources into isolated .preview/unity/win-workspace/project.
console.log('[unity-win] Syncing Unity project sources to .preview/unity/win-workspace/project...')
mkdirSync(projectDir, { recursive: true })
for (const sub of ['Assets', 'Packages', 'ProjectSettings', 'asset-recipes']) {
  const src = join(unityDir, sub)
  if (existsSync(src)) robocopy(src, join(projectDir, sub), ['/MIR', '/MT:16'])
}
if (noPassengers) {
  // Keep public Win64 / MSIX workspaces strictly free of INTERNAL_REVIEW_ONLY passenger assets.
  rmSync(join(projectDir, 'Assets/StationDesigner/Generated/Passengers'), { recursive: true, force: true })
  rmSync(join(projectDir, 'Assets/StationDesigner/Generated/Passengers.meta'), { force: true })
  rmSync(join(projectDir, 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity'), { force: true })
  rmSync(join(projectDir, 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity.meta'), { force: true })
}
// StandaloneWindows64 BuildPipeline flips UnityConnectSettings m_Enabled 0 -> 1 inside
// the project copy; pre-normalize it in the isolated workspace so provenance matches.
const connectAsset = join(projectDir, 'ProjectSettings/UnityConnectSettings.asset')
if (existsSync(connectAsset)) {
  const text = readFileSync(connectAsset, 'utf8')
  const normalized = text.replace(/^(\s*m_Enabled:\s*)0\b/m, '$11')
  if (normalized !== text) writeFileSync(connectAsset, normalized, 'utf8')
}
// Configure the isolated Windows player as a resizable 1600x900 windowed app named "Station Designer"
// by Erikaze without modifying unity/ProjectSettings/ProjectSettings.asset in Git.
const playerSettingsAsset = join(projectDir, 'ProjectSettings/ProjectSettings.asset')
if (existsSync(playerSettingsAsset)) {
  const text = readFileSync(playerSettingsAsset, 'utf8')
  let patched = text
    .replace(/^(\s*companyName:\s*).*$/m, '$1Erikaze')
    .replace(/^(\s*productName:\s*).*$/m, '$1Station Designer')
    .replace(/^(\s*defaultScreenWidth:\s*)\d+/m, '$11600')
    .replace(/^(\s*defaultScreenHeight:\s*)\d+/m, '$1900')
    .replace(/^(\s*resizableWindow:\s*)\d+/m, '$11')
    .replace(/^(\s*fullscreenMode:\s*)\d+/m, '$13')
  if (version) {
    patched = patched.replace(/^(\s*bundleVersion:\s*).*$/m, `$1${version}`)
  }
  if (patched !== text) writeFileSync(playerSettingsAsset, patched, 'utf8')
}
if (!existsSync(join(projectDir, 'Library')) && existsSync(join(unityDir, 'Library'))) {
  console.log('[unity-win] Seeding Library cache from unity/Library...')
  robocopy(join(unityDir, 'Library'), join(projectDir, 'Library'), ['/E', '/MT:16'])
}

// 3. Ensure Win64 build target and scene (+ local soft-human passenger cohort when available)
// are committed before metro-unity.ps1 snapshots inputs.
const editorExe = resolveUnityEditor()
const targetMarker = join(workspace, 'target-win64.txt')
const hasLocalPassengers = !noPassengers
  && existsSync(join(projectDir, 'Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json'))
const localPassengerScene = 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity'
const needsBootstrap = !existsSync(join(projectDir, 'Assets/StationDesigner/Scenes/StationGameLocal.unity'))
  || !existsSync(join(projectDir, 'Assets/StationDesigner/Generated/RuntimeCatalogue.asset'))
const needsPassengerScene = hasLocalPassengers && !existsSync(join(projectDir, localPassengerScene))
if (needsBootstrap || needsPassengerScene || !existsSync(targetMarker)) {
  const prepLog = join(workspace, 'prepare-win64.log')
  const prepArgs = ['-batchmode', '-nographics', '-quit', '-projectPath', projectDir, '-buildTarget', 'Win64', '-logFile', prepLog]
  if (needsPassengerScene) {
    prepArgs.push('-executeMethod', 'Metro.Editor.StationLocalProfile.PrepareLocalWebBuild')
    run(editorExe, prepArgs, 'Preparing Win64 scene with local soft-human passenger cohort')
  } else if (needsBootstrap) {
    prepArgs.push('-executeMethod', 'Metro.Editor.StationGameScene.Generate')
    run(editorExe, prepArgs, 'Bootstrapping StationGameLocal on Win64')
  } else {
    run(editorExe, prepArgs, 'Switching isolated workspace target to Win64')
  }
  writeFileSync(targetMarker, new Date().toISOString())
}

// 4. Build MetroStation.exe via metro-unity.ps1 build-windows (provenance-verified).
const buildWinArgs = [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', join(repo, 'unity/scripts/metro-unity.ps1'),
  'build-windows',
  '-Configuration', configuration,
  '-Scene', 'StationGameLocal',
  '-ProjectPath', projectDir,
  '-OutputDirectory', outDir,
]
if (hasLocalPassengers) {
  buildWinArgs.push('-ScenePath', localPassengerScene)
}
run('powershell', buildWinArgs, `Building MetroStation.exe (${configuration}${hasLocalPassengers ? ', with passengers' : ''})`)

const playerDir = join(outDir, `windows-${configuration}`)
const exePath = join(playerDir, 'MetroStation.exe')
const webViewExe = join(playerDir, 'MetroStation_Data/StreamingAssets/MetroUi/bin/MetroEditorWebView.exe')
const uiManifest = join(playerDir, 'MetroStation_Data/StreamingAssets/MetroUi/ui/.vite/manifest.json')
if (!existsSync(exePath)) throw new Error(`Missing built player: ${exePath}`)
if (!existsSync(webViewExe) || !existsSync(uiManifest)) {
  throw new Error(`Missing staged StreamingAssets/MetroUi in ${playerDir}`)
}

if (buildMsix) {
  const res = await packWindowsMsix(repo, playerDir, '', {
    version: version || undefined,
    identityPath: msixIdentity || undefined,
    devSign,
  })
  const latestMsix = join(repo, '.preview/unity/StationDesigner.msix')
  if (res.outputMsix !== latestMsix) copyFileSync(res.outputMsix, latestMsix)
  console.log(`\n[unity-win] Microsoft Store MSIX ready: ${res.outputMsix}`)
  console.log(`[unity-win] Latest copy:                ${latestMsix}`)
  if (res.devSigned) {
    console.log(`[unity-win] Dev-signed sideload copy:   ${res.devSigned.signedMsix}`)
  }
} else if (buildSteam) {
  const res = await packWindowsSteam(repo, playerDir, '', {
    configPath: steamConfig || undefined,
    steamSdkPath: steamSdkPath || undefined,
    appId: steamAppId || undefined,
    depotId: steamDepotId || undefined,
    setLive: steamSetLive || undefined,
    description: steamDescription || undefined,
    requireSteamRestart: steamRequireRestart || undefined,
    version: version || '0.1.0',
  })
  console.log(`\n[unity-win] Steam depot ready:     ${res.depotDir}`)
  console.log(`[unity-win] Launch executable:     "${join(res.depotDir, 'MetroStation.exe')}"`)
  console.log(`[unity-win] Steamworks SDK DLL:    ${res.steamSdk ? `bundled (${res.steamSdk.source})` : 'not bundled (DRM-free)'}`)
  console.log(`[unity-win] Steam Cloud Auto-Cloud: WinAppDataLocalLow/Erikaze/Station Designer (*.metro.json)`)
  if (res.vdf) {
    console.log(`[unity-win] SteamPipe App VDF:     ${res.vdf.appVdf}`)
    console.log(`[unity-win] Upload via SteamCMD:   "${res.steamCmdPath}" +login <account> +run_app_build "${res.vdf.appVdf}" +quit`)
  } else {
    console.log('[unity-win] Tip: create steam/steam-config.local.json (see steam/steam-config.example.json) or pass --app-id <id> --depot-id <id> to also generate SteamPipe VDF scripts.')
  }
} else if (!noBundle) {
  // 5. Pack everything (UnityPlayer.dll, Data, self-contained MetroEditorWebView, UI, audio)
  // into ONE standalone single-file StationDesigner.exe.
  const bundledExe = join(outDir, 'StationDesigner.exe')
  await packWindowsExe(repo, playerDir, bundledExe)
  const latestExe = join(repo, '.preview/unity/StationDesigner.exe')
  copyFileSync(bundledExe, latestExe)
  if (process.platform === 'win32') {
    spawnSync('icacls', [latestExe, '/setintegritylevel', 'Medium'], { windowsHide: true })
  }

  console.log(`\n[unity-win] Single-file standalone executable ready: ${latestExe}`)
  console.log(`[unity-win] Archived copy: ${bundledExe}`)
  console.log(`[unity-win] Run game:      "${latestExe}"`)
  console.log(`[unity-win] Run benchmark: "${latestExe}" -benchmark`)
} else {
  console.log(`\n[unity-win] Raw Windows player ready: ${playerDir}`)
}
