// Package a Unity StandaloneWindows64 player directory (`windows-Release/`)
// plus a self-contained `MetroEditorWebView.exe` into an unpacked Steam depot
// directory (`steam/depot/`), verified clean of internal passenger assets,
// with optional SteamPipe VDF build scripts under `steam/pipe/`.
//
// Unlike `pack-windows-exe.mjs` (single-file SFX) and `pack-windows-msix.mjs`
// (Microsoft Store MSIX), Steam installs and delta-patches an unpacked directory.
//
// Usage:
//   node tools/unity-web/pack-windows-steam.mjs <player-dir> [output-dir]
//     [--steam-config <json>] [--steam-sdk <zip|dir|dll>] [--app-id <id>] [--depot-id <id>]
//     [--set-live <branch>] [--description <text>] [--require-steam-restart]
//     [--version <semver>] [--allow-local-passengers]
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CONFIG_REL = 'steam/steam-config.local.json'
const DEFAULT_DEPOT_REL = 'steam/depot'
const DEFAULT_PIPE_REL = 'steam/pipe'
const DEFAULT_SDK_CACHE_REL = 'steam/sdk'

export const STEAM_COMPANY_NAME = 'Erikaze'
export const STEAM_PRODUCT_NAME = 'Station Designer'
export const STEAM_CLOUD_ROOT = `WinAppDataLocalLow/${STEAM_COMPANY_NAME}/${STEAM_PRODUCT_NAME}`
export const STEAM_CLOUD_PATTERN = '*.metro.json'

function run(cmd, args, label, opts = {}) {
  console.log(`[unity-steam] ${label}...`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
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

function stripNonShippableFiles(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (/_BackUpThisFolder_ButDontShipItWithYourGame$/i.test(entry.name) ||
          /_BurstDebugInformation_DoNotShip$/i.test(entry.name)) {
        rmSync(full, { recursive: true, force: true })
        continue
      }
      stripNonShippableFiles(full)
    } else if (/\.(pdb|xml)$/i.test(entry.name) || /^steam_appid\.txt$/i.test(entry.name)) {
      rmSync(full, { force: true })
    }
  }
}

function measureTree(dir) {
  let files = 0
  let totalBytes = 0
  function walk(cur) {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        files += 1
        totalBytes += statSync(full).size
      }
    }
  }
  walk(dir)
  return { files, totalBytes }
}

function parsePositiveInt(value, label) {
  if (value === undefined || value === null || value === '') return null
  const str = String(value).trim()
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid Steam ${label} "${value}": expected a positive integer`)
  }
  const num = Number(str)
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new Error(`Invalid Steam ${label} "${value}": expected a positive integer`)
  }
  return num
}

export function escapeVdf(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ')
}

export function loadSteamConfig(repoRoot, options = {}) {
  const repo = resolve(repoRoot)
  const filePath = options.configPath
    ? resolve(repo, options.configPath)
    : process.env.METRO_STEAM_CONFIG_FILE
      ? resolve(repo, process.env.METRO_STEAM_CONFIG_FILE)
      : join(repo, DEFAULT_CONFIG_REL)

  let fileData = {}
  if (existsSync(filePath)) {
    fileData = JSON.parse(readFileSync(filePath, 'utf8'))
  } else if (options.configPath) {
    throw new Error(`Steam config file not found: ${filePath}`)
  }

  if (Object.prototype.hasOwnProperty.call(fileData, 'password') ||
      Object.prototype.hasOwnProperty.call(fileData, 'steamPassword')) {
    throw new Error(`Do not store Steam passwords in ${filePath}. Sign in interactively with steamcmd so credentials stay inside steamcmd's cached session.`)
  }

  const appId = parsePositiveInt(
    options.appId ?? process.env.METRO_STEAM_APP_ID ?? fileData.appId,
    'appId',
  )
  const depotId = parsePositiveInt(
    options.depotId ?? process.env.METRO_STEAM_DEPOT_ID ?? fileData.depotId,
    'depotId',
  )
  if ((appId && !depotId) || (!appId && depotId)) {
    throw new Error('SteamPipe VDF generation requires both appId and depotId.')
  }

  const steamUser = String(
    options.steamUser ?? process.env.METRO_STEAM_USER ?? fileData.steamUser ?? '',
  ).trim()
  const description = String(
    options.description ?? process.env.METRO_STEAM_DESCRIPTION ?? fileData.description ?? 'Station Designer Windows x64',
  ).trim()
  const setLive = String(
    options.setLive ?? process.env.METRO_STEAM_SET_LIVE ?? fileData.setLive ?? '',
  ).trim()
  const requireSteamRestart = Boolean(
    options.requireSteamRestart ??
    (process.env.METRO_STEAM_REQUIRE_RESTART === '1' || process.env.METRO_STEAM_REQUIRE_RESTART === 'true'
      ? true
      : fileData.requireSteamRestart),
  )

  return {
    appId,
    depotId,
    steamUser,
    description,
    setLive,
    requireSteamRestart,
    sourcePath: existsSync(filePath) ? filePath : null,
  }
}

export function renderDepotBuildVdf({
  depotId,
  contentRoot,
  excludes = [
    '*.pdb',
    '*.xml',
    'steam_appid.txt',
    '*_BackUpThisFolder_ButDontShipItWithYourGame/*',
    '*_BurstDebugInformation_DoNotShip/*',
  ],
}) {
  const id = parsePositiveInt(depotId, 'depotId')
  if (!id) throw new Error('depotId is required to render depot_build VDF')
  const excludeLines = excludes
    .map(pattern => `  "FileExclusion" "${escapeVdf(pattern)}"`)
    .join('\n')
  return `"DepotBuildConfig"
{
  "DepotID" "${id}"
  "ContentRoot" "${escapeVdf(contentRoot)}"
  "FileMapping"
  {
    "LocalPath" "*"
    "DepotPath" "."
    "recursive" "1"
  }
${excludeLines}
}
`
}

export function renderAppBuildVdf({
  appId,
  depotId,
  depotVdfPath,
  contentRoot,
  buildOutput,
  description = 'Station Designer Windows x64',
  setLive = '',
}) {
  const app = parsePositiveInt(appId, 'appId')
  const depot = parsePositiveInt(depotId, 'depotId')
  if (!app || !depot) throw new Error('appId and depotId are required to render app_build VDF')
  const setLiveLine = setLive ? `\n  "SetLive" "${escapeVdf(setLive)}"` : ''
  return `"AppBuild"
{
  "AppID" "${app}"
  "Desc" "${escapeVdf(description)}"
  "BuildOutput" "${escapeVdf(buildOutput)}"
  "ContentRoot" "${escapeVdf(contentRoot)}"${setLiveLine}
  "Depots"
  {
    "${depot}" "${escapeVdf(depotVdfPath)}"
  }
}
`
}

export function renderWebView2InstallScriptVdf() {
  return `"InstallScript"
{
  "Run Process"
  {
    "WebView2 Evergreen Runtime"
    {
      "process 1" "%INSTALLDIR%\\\\_CommonRedist\\\\WebView2\\\\MicrosoftEdgeWebview2Setup.exe"
      "command 1" "/silent /install"
      "NoCleanUp" "1"
      "HasRunKey" "HKEY_LOCAL_MACHINE\\\\SOFTWARE\\\\WOW6432Node\\\\Microsoft\\\\EdgeUpdate\\\\Clients\\\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    }
  }
}
"kvsignatures"
{
}
`
}

export function resolveSteamCmdPath(repoRoot) {
  const candidates = [
    process.env.METRO_STEAMCMD,
    join(homedir(), 'Downloads', 'steamcmd', 'steamcmd.exe'),
    'C:/steamcmd/steamcmd.exe',
    join(resolve(repoRoot), DEFAULT_SDK_CACHE_REL, 'steamcmd.exe'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate)
  }
  return 'steamcmd'
}

function extractEntryFromZip(zipPath, entryName, destPath) {
  mkdirSync(dirname(destPath), { recursive: true })
  const psScript = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($env:METRO_ZIP_SRC)
try {
  $entry = $zip.GetEntry($env:METRO_ZIP_ENTRY)
  if (-not $entry) { throw "Archive entry not found: $env:METRO_ZIP_ENTRY" }
  $inStream = $entry.Open()
  try {
    $outStream = [System.IO.File]::Create($env:METRO_ZIP_DST)
    try { $inStream.CopyTo($outStream) } finally { $outStream.Dispose() }
  } finally { $inStream.Dispose() }
} finally { $zip.Dispose() }
`
  run('powershell', ['-NoProfile', '-Command', psScript], `Extracting ${entryName} from ${zipPath}`, {
    env: {
      ...process.env,
      METRO_ZIP_SRC: zipPath,
      METRO_ZIP_ENTRY: entryName,
      METRO_ZIP_DST: destPath,
    },
  })
}

export function resolveSteamApiDll(repoRoot, explicitSdkPath = '') {
  const repo = resolve(repoRoot)
  const cacheDir = join(repo, DEFAULT_SDK_CACHE_REL)
  const cachedDll = join(cacheDir, 'steam_api64.dll')

  const trySource = rawPath => {
    if (!rawPath) return null
    const full = resolve(repo, rawPath)
    if (!existsSync(full)) return null
    const st = statSync(full)
    if (st.isFile() && /steam_api64\.dll$/i.test(full)) {
      return { dllPath: full, source: full }
    }
    if (st.isFile() && /\.zip$/i.test(full)) {
      extractEntryFromZip(full, 'sdk/redistributable_bin/win64/steam_api64.dll', cachedDll)
      return { dllPath: cachedDll, source: full }
    }
    if (st.isDirectory()) {
      for (const rel of [
        'steam_api64.dll',
        'redistributable_bin/win64/steam_api64.dll',
        'sdk/redistributable_bin/win64/steam_api64.dll',
      ]) {
        const candidate = join(full, rel)
        if (existsSync(candidate)) return { dllPath: candidate, source: candidate }
      }
    }
    return null
  }

  const fromExplicit = trySource(explicitSdkPath || process.env.METRO_STEAM_SDK)
  if (fromExplicit) return fromExplicit
  if (existsSync(cachedDll)) return { dllPath: cachedDll, source: cachedDll }

  // Auto-discover official Steamworks SDK zip in the user's Downloads folder (latest version wins).
  const downloads = join(homedir(), 'Downloads')
  if (existsSync(downloads)) {
    const zips = readdirSync(downloads)
      .filter(name => /^steamworks_sdk_\d+\.zip$/i.test(name))
      .sort()
      .reverse()
    for (const name of zips) {
      const hit = trySource(join(downloads, name))
      if (hit) return hit
    }
  }
  return null
}

export async function packWindowsSteam(repoRoot, playerDir, outputDir, options = {}) {
  const repo = resolve(repoRoot)
  const srcPlayer = resolve(playerDir)
  if (!existsSync(join(srcPlayer, 'MetroStation.exe')) || !existsSync(join(srcPlayer, 'UnityPlayer.dll'))) {
    throw new Error(`Incomplete Unity Windows player directory: ${srcPlayer}`)
  }

  const steamConfig = loadSteamConfig(repo, options)
  const depotDir = resolve(outputDir || join(repo, DEFAULT_DEPOT_REL))
  const workspace = join(repo, '.preview/unity/win-workspace')
  const selfContainedWebViewDir = join(workspace, 'webview-selfcontained')
  const stageDir = join(workspace, `steam-stage-${process.pid}`)

  try {
    // 1. Publish self-contained MetroEditorWebView.exe (zero .NET install required on target PC).
    rmSync(selfContainedWebViewDir, { recursive: true, force: true })
    run('dotnet', [
      'publish',
      join(repo, 'tools/unity-editor-ui/MetroEditorWebView.csproj'),
      '-c', 'Release',
      '-r', 'win-x64',
      '--self-contained', 'true',
      '-p:DebugType=none',
      '-p:DebugSymbols=false',
      '-o', selfContainedWebViewDir,
    ], 'Publishing self-contained MetroEditorWebView.exe', { cwd: repo })
    stripNonShippableFiles(selfContainedWebViewDir)

    // 2. Stage clean unpacked player tree without debug/backup artifacts and with self-contained MetroUi/bin.
    console.log('[unity-steam] Staging clean unpacked Steam depot...')
    rmSync(stageDir, { recursive: true, force: true })
    robocopy(srcPlayer, stageDir, [
      '/E',
      '/MT:16',
      '/XD',
      'MetroStation_BackUpThisFolder_ButDontShipItWithYourGame',
      'MetroStation_BurstDebugInformation_DoNotShip',
    ])
    const stagedWebViewBin = join(stageDir, 'MetroStation_Data/StreamingAssets/MetroUi/bin')
    rmSync(stagedWebViewBin, { recursive: true, force: true })
    robocopy(selfContainedWebViewDir, stagedWebViewBin, ['/E', '/MT:16'])
    stripNonShippableFiles(stageDir)

    // 3. Stage official steam_api64.dll from Steamworks SDK (kept out of Git) and optional steam-runtime.json.
    const steamSdk = options.noSteamSdk ? null : resolveSteamApiDll(repo, options.steamSdkPath || '')
    if (steamSdk) {
      copyFileSync(steamSdk.dllPath, join(stageDir, 'steam_api64.dll'))
      console.log(`[unity-steam] Staged steam_api64.dll from ${steamSdk.source}`)
    } else {
      console.log('[unity-steam] No Steamworks SDK found; staging DRM-free Steam depot without steam_api64.dll.')
    }

    if (steamConfig.appId) {
      const runtimeCfgPath = join(stageDir, 'MetroStation_Data/StreamingAssets/MetroUi/steam-runtime.json')
      writeFileSync(
        runtimeCfgPath,
        JSON.stringify(
          {
            appId: steamConfig.appId,
            requireSteamRestart: steamConfig.requireSteamRestart,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      )
    }

    // 4. Enforce public passenger-profile separation before finalizing the Steam depot.
    if (!options.allowLocalPassengers) {
      run(
        process.execPath,
        [join(repo, 'unity/tests/passenger-profile.test.mjs'), '--pack', stageDir],
        'Verifying public-pack passenger isolation on Steam depot staging tree',
        { cwd: repo },
      )
    }

    // 5. Mirror staged depot into target directory.
    mkdirSync(depotDir, { recursive: true })
    robocopy(stageDir, depotDir, ['/MIR', '/MT:16'])

    if (process.platform === 'win32') {
      for (const exe of [
        join(depotDir, 'MetroStation.exe'),
        join(depotDir, 'MetroStation_Data/StreamingAssets/MetroUi/bin/MetroEditorWebView.exe'),
      ]) {
        if (existsSync(exe)) {
          spawnSync('icacls', [exe, '/setintegritylevel', 'Medium'], { windowsHide: true })
        }
      }
    }

    const stats = measureTree(depotDir)

    // 6. Generate SteamPipe VDFs under steam/pipe/ when appId + depotId are configured.
    const pipeDir = join(repo, DEFAULT_PIPE_REL)
    let vdf = null
    if (steamConfig.appId && steamConfig.depotId) {
      mkdirSync(pipeDir, { recursive: true })
      const buildOutput = join(pipeDir, 'output')
      mkdirSync(buildOutput, { recursive: true })
      const depotVdf = join(pipeDir, `depot_build_${steamConfig.depotId}.vdf`)
      const appVdf = join(pipeDir, `app_build_${steamConfig.appId}.vdf`)
      const installScriptVdf = join(pipeDir, 'installscript.vdf')

      writeFileSync(
        depotVdf,
        renderDepotBuildVdf({
          depotId: steamConfig.depotId,
          contentRoot: depotDir,
        }),
        'utf8',
      )
      writeFileSync(
        appVdf,
        renderAppBuildVdf({
          appId: steamConfig.appId,
          depotId: steamConfig.depotId,
          depotVdfPath: relative(pipeDir, depotVdf),
          contentRoot: depotDir,
          buildOutput,
          description: options.version
            ? `${steamConfig.description} (${options.version})`
            : steamConfig.description,
          setLive: steamConfig.setLive,
        }),
        'utf8',
      )
      writeFileSync(installScriptVdf, renderWebView2InstallScriptVdf(), 'utf8')
      vdf = { appVdf, depotVdf, installScriptVdf, buildOutput }
    }

    const manifestPath = join(dirname(depotDir), 'depot-manifest.json')
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          companyName: STEAM_COMPANY_NAME,
          productName: STEAM_PRODUCT_NAME,
          version: options.version || '0.1.0',
          executable: 'MetroStation.exe',
          depotDir,
          files: stats.files,
          totalBytes: stats.totalBytes,
          steamApiBundled: Boolean(steamSdk),
          steamApiSource: steamSdk?.source ?? null,
          steamCmdPath: resolveSteamCmdPath(repo),
          steamCloud: {
            root: STEAM_CLOUD_ROOT,
            pattern: STEAM_CLOUD_PATTERN,
          },
          steamConfig: {
            appId: steamConfig.appId,
            depotId: steamConfig.depotId,
            setLive: steamConfig.setLive,
            requireSteamRestart: steamConfig.requireSteamRestart,
          },
          vdf,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    console.log(
      `[unity-steam] Unpacked Steam depot ready: ${depotDir} (${stats.files} files, ${(stats.totalBytes / (1024 * 1024)).toFixed(1)} MB, steam_api64.dll=${steamSdk ? 'bundled' : 'absent'})`,
    )
    return { depotDir, manifestPath, stats, steamConfig, vdf, steamSdk, steamCmdPath: resolveSteamCmdPath(repo) }
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = resolve(import.meta.dirname, '../..')
  const args = process.argv.slice(2)
  const positional = []
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--steam-config' && i + 1 < args.length) opts.configPath = args[++i]
    else if (args[i] === '--app-id' && i + 1 < args.length) opts.appId = args[++i]
    else if (args[i] === '--depot-id' && i + 1 < args.length) opts.depotId = args[++i]
    else if (args[i] === '--set-live' && i + 1 < args.length) opts.setLive = args[++i]
    else if (args[i] === '--description' && i + 1 < args.length) opts.description = args[++i]
    else if (args[i] === '--version' && i + 1 < args.length) opts.version = args[++i]
    else if (args[i] === '--steam-sdk' && i + 1 < args.length) opts.steamSdkPath = args[++i]
    else if (args[i] === '--no-steam-sdk') opts.noSteamSdk = true
    else if (args[i] === '--require-steam-restart') opts.requireSteamRestart = true
    else if (args[i] === '--allow-local-passengers') opts.allowLocalPassengers = true
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node tools/unity-web/pack-windows-steam.mjs <player-dir> [output-dir] [--steam-config <json>] [--app-id <id>] [--depot-id <id>] [--set-live <branch>] [--description <text>] [--require-steam-restart] [--version <semver>]')
      process.exit(0)
    } else {
      positional.push(args[i])
    }
  }
  const [playerDir, outputDir] = positional
  if (!playerDir) {
    console.error('Usage: node tools/unity-web/pack-windows-steam.mjs <player-dir> [output-dir] [--steam-config <json>] [--app-id <id>] [--depot-id <id>] [--set-live <branch>]')
    process.exit(1)
  }
  await packWindowsSteam(repo, playerDir, outputDir, opts)
}
