// One-command Steam Windows x64 build & SteamPipe upload orchestrator.
//
// 1. Unless `--skip-build` is passed, runs `tools/unity-web/build-windows.mjs --steam`
//    to build the clean public Win64 player, bundle self-contained MetroEditorWebView.exe
//    and official Steamworks SDK 1.65 `steam_api64.dll` into `steam/depot/`, verify
//    public passenger isolation, and generate SteamPipe VDFs in `steam/pipe/`.
// 2. Resolves `steamcmd.exe` and runs `+login <steamUser> +run_app_build <appVdf> +quit`.
//    Passwords are never accepted or stored in repo files; SteamCMD prompts interactively
//    on first login and reuses its cached token on subsequent uploads.
//
// Usage:
//   npm run deploy:unity:steam -- [--version 0.1.0] [--steam-user <account>]
//     [--steam-config <json>] [--steam-sdk <zip|dir|dll>] [--steamcmd <exe>]
//     [--app-id <id> --depot-id <id>] [--set-live <branch>] [--description <text>]
//     [--require-steam-restart] [--skip-build] [--dry-run]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  loadSteamConfig,
  renderAppBuildVdf,
  renderDepotBuildVdf,
  renderWebView2InstallScriptVdf,
  resolveSteamCmdPath,
} from './pack-windows-steam.mjs'

export function buildSteamCmdArgs({ steamUser, appVdfPath }) {
  const user = String(steamUser ?? '').trim()
  if (!user) {
    throw new Error(
      'Missing Steam build account username. Set "steamUser" in steam/steam-config.local.json, pass --steam-user <account>, or set METRO_STEAM_USER.',
    )
  }
  if (!appVdfPath) {
    throw new Error('Missing SteamPipe app_build VDF path.')
  }
  return ['+login', user, '+run_app_build', resolve(appVdfPath), '+quit']
}

export function ensureSteamPipeVdfs(repoRoot, config, { depotDir, version = '' } = {}) {
  const repo = resolve(repoRoot)
  if (!config.appId || !config.depotId) {
    throw new Error(
      'Missing Steam appId/depotId. Create steam/steam-config.local.json (see steam/steam-config.example.json) or pass --app-id <id> --depot-id <id>.',
    )
  }
  const resolvedDepot = resolve(depotDir || join(repo, 'steam/depot'))
  if (!existsSync(join(resolvedDepot, 'MetroStation.exe'))) {
    throw new Error(`Steam depot not found at ${resolvedDepot}. Run without --skip-build or run: npm run build:unity:steam`)
  }
  const pipeDir = join(repo, 'steam/pipe')
  const buildOutput = join(pipeDir, 'output')
  mkdirSync(buildOutput, { recursive: true })
  const depotVdf = join(pipeDir, `depot_build_${config.depotId}.vdf`)
  const appVdf = join(pipeDir, `app_build_${config.appId}.vdf`)
  const installScriptVdf = join(pipeDir, 'installscript.vdf')

  writeFileSync(
    depotVdf,
    renderDepotBuildVdf({
      depotId: config.depotId,
      contentRoot: resolvedDepot,
    }),
    'utf8',
  )
  writeFileSync(
    appVdf,
    renderAppBuildVdf({
      appId: config.appId,
      depotId: config.depotId,
      depotVdfPath: relative(pipeDir, depotVdf),
      contentRoot: resolvedDepot,
      buildOutput,
      description: version ? `${config.description} (${version})` : config.description,
      setLive: config.setLive,
    }),
    'utf8',
  )
  writeFileSync(installScriptVdf, renderWebView2InstallScriptVdf(), 'utf8')
  return { appVdf, depotVdf, installScriptVdf, buildOutput, depotDir: resolvedDepot }
}

function run(cmd, cmdArgs, label, cwd) {
  console.log(`[unity-steam-deploy] ${label}...`)
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: false })
  if (res.error) throw res.error
  if ((res.status ?? 1) !== 0) throw new Error(`${label} failed with exit code ${res.status}`)
}

async function main() {
  const repo = resolve(import.meta.dirname, '../..')
  const args = process.argv.slice(2)
  const opts = {
    skipBuild: false,
    dryRun: false,
    configuration: 'Release',
    version: '',
    configPath: '',
    steamSdkPath: '',
    steamCmdPath: '',
    steamUser: '',
    appId: '',
    depotId: '',
    setLive: '',
    description: '',
    requireSteamRestart: false,
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--skip-build') opts.skipBuild = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--configuration' && i + 1 < args.length) opts.configuration = args[++i]
    else if (a === '--version' && i + 1 < args.length) opts.version = args[++i]
    else if (a === '--steam-config' && i + 1 < args.length) opts.configPath = args[++i]
    else if (a === '--steam-sdk' && i + 1 < args.length) opts.steamSdkPath = args[++i]
    else if (a === '--steamcmd' && i + 1 < args.length) opts.steamCmdPath = args[++i]
    else if (a === '--steam-user' && i + 1 < args.length) opts.steamUser = args[++i]
    else if (a === '--app-id' && i + 1 < args.length) opts.appId = args[++i]
    else if (a === '--depot-id' && i + 1 < args.length) opts.depotId = args[++i]
    else if (a === '--set-live' && i + 1 < args.length) opts.setLive = args[++i]
    else if (a === '--description' && i + 1 < args.length) opts.description = args[++i]
    else if (a === '--require-steam-restart') opts.requireSteamRestart = true
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node tools/unity-web/deploy-steam.mjs [--version 0.1.0] [--steam-user <account>] [--steam-config <json>] [--steam-sdk <zip|dir|dll>] [--steamcmd <exe>] [--app-id <id> --depot-id <id>] [--set-live <branch>] [--description <text>] [--require-steam-restart] [--skip-build] [--dry-run]',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${a}`)
    }
  }

  const config = loadSteamConfig(repo, {
    configPath: opts.configPath || undefined,
    appId: opts.appId || undefined,
    depotId: opts.depotId || undefined,
    steamUser: opts.steamUser || undefined,
    setLive: opts.setLive || undefined,
    description: opts.description || undefined,
    requireSteamRestart: opts.requireSteamRestart || undefined,
  })
  if (!config.appId || !config.depotId) {
    throw new Error(
      'Missing Steam appId/depotId. Create steam/steam-config.local.json (see steam/steam-config.example.json) or pass --app-id <id> --depot-id <id>.',
    )
  }

  if (!opts.skipBuild) {
    const buildArgs = [
      join(repo, 'tools/unity-web/build-windows.mjs'),
      '--steam',
      '--configuration', opts.configuration,
    ]
    if (opts.version) buildArgs.push('--version', opts.version)
    if (opts.configPath) buildArgs.push('--steam-config', opts.configPath)
    if (opts.steamSdkPath) buildArgs.push('--steam-sdk', opts.steamSdkPath)
    if (opts.appId) buildArgs.push('--app-id', opts.appId)
    if (opts.depotId) buildArgs.push('--depot-id', opts.depotId)
    if (opts.setLive) buildArgs.push('--set-live', opts.setLive)
    if (opts.description) buildArgs.push('--description', opts.description)
    if (opts.requireSteamRestart) buildArgs.push('--require-steam-restart')
    run(process.execPath, buildArgs, 'Building and staging verified Steam depot', repo)
  }

  const vdf = ensureSteamPipeVdfs(repo, config, { version: opts.version })
  const steamCmd = opts.steamCmdPath ? resolve(repo, opts.steamCmdPath) : resolveSteamCmdPath(repo)
  const cmdArgs = buildSteamCmdArgs({ steamUser: config.steamUser, appVdfPath: vdf.appVdf })

  console.log(`[unity-steam-deploy] SteamCMD: ${steamCmd}`)
  console.log(`[unity-steam-deploy] App VDF:  ${vdf.appVdf}`)
  console.log(`[unity-steam-deploy] Depot:    ${vdf.depotDir}`)
  if (opts.dryRun) {
    console.log(`[unity-steam-deploy] Dry run command: "${steamCmd}" ${cmdArgs.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
    return
  }

  run(steamCmd, cmdArgs, `Uploading Steam App ${config.appId} (Depot ${config.depotId})`, repo)
  console.log(`[unity-steam-deploy] SteamPipe upload finished for App ${config.appId} (Depot ${config.depotId}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
