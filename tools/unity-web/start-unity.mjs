import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join, relative, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const SCENES = new Set(['StationGameLocal'])
const CONFIGURATIONS = new Set(['Development', 'Release'])
export const MUTABLE_BUILD_INPUTS = new Set(['Assets/Settings/UniversalRenderPipelineGlobalSettings.asset'])
const LOCAL_PASSENGER_ROOT = 'Assets/StationDesigner/Generated/Passengers'
const LOCAL_WEB_SCENE = 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity'
const LOCAL_PASSENGER_FILES = [`${LOCAL_PASSENGER_ROOT}.meta`, LOCAL_WEB_SCENE, `${LOCAL_WEB_SCENE}.meta`]
const isLocalPassengerInput = path => path === LOCAL_PASSENGER_ROOT ||
  path.startsWith(`${LOCAL_PASSENGER_ROOT}/`) || LOCAL_PASSENGER_FILES.includes(path)

export function parseUnityStartArgs(argv) {
  const options = {
    buildOnly: false,
    rebuild: false,
    bootstrap: false,
    help: false,
    port: 8787,
    ip: '127.0.0.1',
    scene: 'StationGameLocal',
    configuration: 'Release',
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--build-only') options.buildOnly = true
    else if (arg === '--rebuild') options.rebuild = true
    else if (arg === '--bootstrap') options.bootstrap = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--port') {
      const raw = argv[++i]
      const port = Number(raw)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port value: ${raw ?? ''}`)
      options.port = port
    } else if (arg === '--ip') {
      const ip = argv[++i]
      if (!ip) throw new Error('--ip requires a host address')
      options.ip = ip
    } else if (arg === '--scene') {
      const scene = argv[++i]
      if (!SCENES.has(scene)) throw new Error(`Invalid --scene value: ${scene ?? ''} (expected ${[...SCENES].join('|')})`)
      options.scene = scene
    } else if (arg === '--configuration') {
      const configuration = argv[++i]
      if (!CONFIGURATIONS.has(configuration)) {
        throw new Error(`Invalid --configuration value: ${configuration ?? ''} (expected Development|Release)`)
      }
      options.configuration = configuration
    } else {
      throw new Error(`Unknown unity option: ${arg}`)
    }
  }
  return options
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

export function snapshotDirectoryInputs(baseDir, subdirs, { ignore = new Set(), includeLocalPassengers = true } = {}) {
  const files = []
  function visit(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (!includeLocalPassengers && isLocalPassengerInput(relative(baseDir, full).replaceAll('\\', '/'))) continue
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  for (const sub of subdirs) visit(join(baseDir, sub))
  files.sort((a, b) => a.localeCompare(b))
  const out = []
  for (const full of files) {
    const rel = relative(baseDir, full).replaceAll('\\', '/')
    if (ignore.has(rel)) continue
    out.push({ Path: rel, SHA256: sha256Bytes(readFileSync(full)) })
  }
  out.sort((a, b) => (a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0))
  return out
}

export function digestSnapshot(entries) {
  const hash = createHash('sha256')
  const sorted = [...entries].sort((a, b) => (a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0))
  for (const item of sorted) {
    hash.update(item.Path)
    hash.update('\0')
    hash.update(String(item.SHA256).toUpperCase())
    hash.update('\n')
  }
  return hash.digest('hex')
}

function sameSnapshots(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false
  const left = [...actual].sort((a, b) => (a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0))
  const right = [...expected].sort((a, b) => (a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0))
  for (let i = 0; i < left.length; i++) {
    if (left[i].Path !== right[i].Path) return false
    if (String(left[i].SHA256).toUpperCase() !== String(right[i].SHA256).toUpperCase()) return false
  }
  return true
}

export function verifyRawBuild(rawBuildDir, { inputs, fixtures, scene, configuration, editorVersionWithRevision }) {
  if (!rawBuildDir || !existsSync(rawBuildDir)) return { ok: false, reason: 'raw build directory missing' }
  const reportPath = `${rawBuildDir}.report.json`
  const provenancePath = `${rawBuildDir}.provenance.json`
  if (!existsSync(reportPath) || !existsSync(provenancePath)) return { ok: false, reason: 'report or provenance missing' }
  let report, provenance
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''))
    provenance = JSON.parse(readFileSync(provenancePath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return { ok: false, reason: `invalid metadata JSON: ${error.message}` }
  }
  if (report.result !== 'Succeeded') return { ok: false, reason: 'build report did not succeed' }
  if (provenance.InputsVerifiedAfterBuild !== true) return { ok: false, reason: 'inputs were not verified after build' }
  const expectedScenePath = String(scene || '').endsWith('.unity')
    ? scene
    : `Assets/StationDesigner/Scenes/${scene}.unity`
  if (provenance.Scene !== expectedScenePath) return { ok: false, reason: 'scene mismatch' }
  if (provenance.Configuration !== configuration) return { ok: false, reason: 'configuration mismatch' }
  if (editorVersionWithRevision && provenance.EditorVersionWithRevision !== editorVersionWithRevision) {
    return { ok: false, reason: 'editor version mismatch' }
  }
  if (!sameSnapshots(inputs, provenance.Inputs)) return { ok: false, reason: 'Unity project inputs changed' }
  if (!sameSnapshots(fixtures, provenance.Fixtures)) return { ok: false, reason: 'fixture inputs changed' }
  if (!Array.isArray(provenance.Files) || provenance.Files.length === 0) return { ok: false, reason: 'missing file inventory' }

  const actualFiles = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) actualFiles.push(relative(rawBuildDir, full).replaceAll('\\', '/'))
      else throw new Error(`Unexpected entry in raw build: ${full}`)
    }
  }
  try {
    walk(rawBuildDir)
  } catch (error) {
    return { ok: false, reason: error.message }
  }
  if (actualFiles.length !== provenance.Files.length) return { ok: false, reason: 'raw build file count mismatch' }
  const declared = new Set(provenance.Files.map(file => file.Path))
  if (declared.size !== provenance.Files.length || actualFiles.some(path => !declared.has(path))) {
    return { ok: false, reason: 'raw build file paths do not match provenance' }
  }
  for (const file of provenance.Files) {
    const full = resolve(rawBuildDir, file.Path)
    if (!full.startsWith(resolve(rawBuildDir) + sep)) return { ok: false, reason: 'provenance path escapes build dir' }
    const bytes = readFileSync(full)
    if (bytes.length !== file.Bytes || sha256Bytes(bytes) !== String(file.SHA256).toUpperCase()) {
      return { ok: false, reason: `output digest mismatch: ${file.Path}` }
    }
  }
  const buildDir = join(rawBuildDir, 'Build')
  if (!existsSync(buildDir)) return { ok: false, reason: 'Build directory missing' }
  const names = readdirSync(buildDir)
  for (const suffix of ['.loader.js', '.framework.js', '.data', '.wasm']) {
    if (names.filter(name => name.endsWith(suffix)).length !== 1) return { ok: false, reason: `expected one ${suffix}` }
  }
  return { ok: true, provenance }
}

function readEditorPin(unityDir) {
  const text = readFileSync(join(unityDir, 'ProjectSettings/ProjectVersion.txt'), 'utf8')
  const version = /^m_EditorVersion:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
  const versionWithRevision = /^m_EditorVersionWithRevision:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
  if (!version || !versionWithRevision) throw new Error('Could not parse unity/ProjectSettings/ProjectVersion.txt')
  const editorPath = process.env.METRO_UNITY_EDITOR || `C:/Program Files/Unity/Hub/Editor/${version}/Editor/Unity.exe`
  const webglModulePath = resolve(editorPath, '..', 'Data/PlaybackEngines/WebGLSupport')
  return { version, versionWithRevision, editorPath, webglModulePath }
}

function checkNodePin(root) {
  const pin = readFileSync(join(root, 'unity/scripts/node-version.txt'), 'utf8').trim()
  const actual = process.version.replace(/^v/, '')
  if (actual !== pin) throw new Error(`Node version ${actual} does not match unity/scripts/node-version.txt (${pin}).`)
}

function runRobocopy(source, destination, extraFlags) {
  mkdirSync(destination, { recursive: true })
  const result = spawnSync('robocopy', [source, destination, ...extraFlags, '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if ((result.status ?? 16) >= 8) {
    throw new Error(`robocopy failed (${result.status}) copying ${source} -> ${destination}\n${result.stdout}\n${result.stderr}`)
  }
}

function mirrorDirectory(source, destination) {
  if (process.platform === 'win32') {
    runRobocopy(source, destination, ['/MIR', '/MT:16'])
    return
  }
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(resolve(destination, '..'), { recursive: true })
  const cp = spawnSync('cp', ['-R', source, destination], { encoding: 'utf8' })
  if (cp.status !== 0) throw new Error(`cp failed copying ${source} -> ${destination}: ${cp.stderr}`)
}

function copyTreeIfMissing(source, destination) {
  if (process.platform === 'win32') {
    runRobocopy(source, destination, ['/E', '/MT:16'])
    return
  }
  mkdirSync(resolve(destination, '..'), { recursive: true })
  const cp = spawnSync('cp', ['-R', source, destination], { encoding: 'utf8' })
  if (cp.status !== 0) throw new Error(`cp failed copying ${source} -> ${destination}: ${cp.stderr}`)
}

function findWarmLibraryDonor(previewUnityDir, sourceUnityDir, targetProjectDir) {
  const candidates = []
  if (existsSync(previewUnityDir)) {
    for (const entry of readdirSync(previewUnityDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'dev-workspace') continue
      const proj = join(previewUnityDir, entry.name, 'project')
      if (resolve(proj) === resolve(targetProjectDir)) continue
      const lib = join(proj, 'Library')
      if (existsSync(join(lib, 'SourceAssetDB')) && !existsSync(join(proj, 'Temp/UnityLockfile'))) {
        candidates.push({ project: proj, library: lib, mtimeMs: statSync(lib).mtimeMs })
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (candidates.length > 0) return candidates[0]
  const sourceLib = join(sourceUnityDir, 'Library')
  if (existsSync(join(sourceLib, 'SourceAssetDB')) && !existsSync(join(sourceUnityDir, 'Temp/UnityLockfile'))) {
    return { project: sourceUnityDir, library: sourceLib, mtimeMs: statSync(sourceLib).mtimeMs }
  }
  return null
}

function clearStaleProjectLock(projectDir) {
  const lockPath = join(projectDir, 'Temp/UnityLockfile')
  if (!existsSync(lockPath)) return
  if (process.platform === 'win32') {
    const normalized = resolve(projectDir).toLowerCase()
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name = 'Unity.exe'\" | Select-Object -ExpandProperty CommandLine",
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    const lines = (ps.stdout || '').toLowerCase()
    if (lines.includes(normalized)) {
      throw new Error(`Isolated Unity workspace is currently in use by a running Unity.exe process: ${projectDir}`)
    }
  }
  unlinkSync(lockPath)
  console.log('[unity] Cleared stale UnityLockfile in isolated dev workspace.')
}

function ensureDemosExported(root, demosOutDir, { quietIfCurrent = false } = {}) {
  const script = join(root, 'tools/unity-parity/export-station-documents.mjs')
  if (!existsSync(script)) return { updated: false }
  const check = spawnSync(process.execPath, [script, '--check', '--out', demosOutDir], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (check.status === 0) return { updated: false }
  if (!quietIfCurrent) console.log('[unity] Exporting updated station demo documents...')
  const write = spawnSync(process.execPath, [script, '--out', demosOutDir], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (write.status !== 0) throw new Error(`export-station-documents.mjs failed with exit code ${write.status}`)
  return { updated: true }
}

function findExistingVerifiedRawBuild(previewUnityDir, configuration, verifyOpts) {
  if (!existsSync(previewUnityDir)) return null
  const candidates = []
  function scan(dir, depth) {
    if (depth > 3 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name === `web-${configuration}.provenance.json`) {
        const rawDir = full.slice(0, -'.provenance.json'.length)
        candidates.push({ rawDir, mtimeMs: statSync(full).mtimeMs })
      } else if (entry.isDirectory() && entry.name !== 'packed' && entry.name !== 'project' && entry.name !== 'packs') {
        scan(full, depth + 1)
      }
    }
  }
  scan(previewUnityDir, 0)
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const candidate of candidates) {
    const check = verifyRawBuild(candidate.rawDir, verifyOpts)
    if (check.ok) return candidate.rawDir
  }
  return null
}

function latestUnityLogLine(logPath) {
  if (!existsSync(logPath)) return ''
  try {
    const stat = statSync(logPath)
    const size = stat.size
    if (size === 0) return ''
    const tailBytes = Math.min(size, 16 * 1024)
    const buf = readFileSync(logPath).subarray(size - tailBytes)
    const lines = buf
      .toString('utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('(Filename:'))
    return lines.at(-1) ?? ''
  } catch {
    return ''
  }
}

function printUnityLogFailureTail(logPath) {
  if (!existsSync(logPath)) return
  try {
    const lines = readFileSync(logPath, 'utf8').split(/\r?\n/)
    const tail = lines.slice(-50).join('\n')
    console.error(`\n[unity] Last lines of ${logPath}:\n${tail}\n`)
  } catch {}
}

function killProcessTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
}

async function runMetroUnityTask(root, task, { projectPath, outputDirectory, scene, scenePath, configuration }) {
  const script = join(root, 'unity/scripts/metro-unity.ps1')
  const logPath = join(outputDirectory, `${task}-EditMode-${configuration}.log`)
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    task,
    '-Scene',
    scene,
    ...(scenePath ? ['-ScenePath', scenePath] : []),
    '-Configuration',
    configuration,
    '-ProjectPath',
    projectPath,
    '-OutputDirectory',
    outputDirectory,
  ]
  const startedAt = Date.now()
  const child = spawn('powershell', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const onSignal = () => {
    killProcessTree(child.pid)
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    const stage = latestUnityLogLine(logPath)
    console.log(`[unity] ${task} running (${elapsed}s)${stage ? ` — ${stage.slice(0, 110)}` : '...'}`)
  }, 10000)
  try {
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('close', code => resolveExit(code ?? 1))
    })
    if (exitCode !== 0) {
      printUnityLogFailureTail(logPath)
      throw new Error(`metro-unity.ps1 ${task} exited with code ${exitCode}.\n${stdout}\n${stderr}`.trim())
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`[unity] ${task} completed in ${elapsed}s.`)
  } finally {
    clearInterval(timer)
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

async function runUnityExecuteMethod(editorPath, { projectPath, logPath, method, label = method }) {
  const args = ['-batchmode', '-nographics', '-quit', '-projectPath', projectPath, '-logFile', logPath, '-executeMethod', method]
  const startedAt = Date.now()
  const child = spawn(editorPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const onSignal = () => {
    killProcessTree(child.pid)
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    const stage = latestUnityLogLine(logPath)
    console.log(`[unity] ${label} running (${elapsed}s)${stage ? ` — ${stage.slice(0, 110)}` : '...'}`)
  }, 10000)
  try {
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('close', code => resolveExit(code ?? 1))
    })
    if (exitCode !== 0) {
      printUnityLogFailureTail(logPath)
      throw new Error(`Unity -executeMethod ${method} exited with code ${exitCode}.\n${stdout}\n${stderr}`.trim())
    }
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(`[unity] ${label} completed in ${elapsed}s.`)
  } finally {
    clearInterval(timer)
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
  }
}

function readWorkspaceState(statePath) {
  if (!existsSync(statePath)) return {}
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return {}
  }
}

function writeWorkspaceState(statePath, state) {
  mkdirSync(resolve(statePath, '..'), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

function pruneOldDirectories(parentDir, keepPaths, maxBackups = 1) {
  if (!existsSync(parentDir)) return
  const protectedSet = new Set(keepPaths.filter(Boolean).map(path => resolve(path).toLowerCase()))
  const others = []
  for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = resolve(parentDir, entry.name)
    if (protectedSet.has(full.toLowerCase())) continue
    try {
      others.push({ full, mtimeMs: statSync(full).mtimeMs })
    } catch {}
  }
  others.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const stale of others.slice(maxBackups)) {
    try {
      rmSync(stale.full, { recursive: true, force: true })
    } catch {}
  }
}

function isPortListening(host, port) {
  return new Promise(resolveListening => {
    const socket = connect({ host, port })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolveListening(true)
    })
    socket.once('error', () => resolveListening(false))
    socket.once('timeout', () => {
      socket.destroy()
      resolveListening(false)
    })
  })
}

async function releasePreviewPortIfOwned(root, host, port) {
  if (!(await isPortListening(host, port))) return
  if (process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        [
          `$conns = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
          'if (!$conns) { exit 0 }',
          '$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique',
          '$procs = foreach ($id in $pids) {',
          '  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue',
          '  $parent = if ($p) { Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)" -ErrorAction SilentlyContinue } else { $null }',
          '  [pscustomobject]@{ Pid=$id; Name=$p.Name; Cmd=$p.CommandLine; ParentPid=$p.ParentProcessId; ParentName=$parent.Name; ParentCmd=$parent.CommandLine }',
          '}',
          '$procs | ConvertTo-Json -Compress',
        ].join('; '),
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    const text = (ps.stdout || '').trim()
    if (text) {
      const parsed = JSON.parse(text)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const repoMarker = resolve(root, '.preview/unity').toLowerCase()
      for (const proc of list) {
        const combined = `${proc.Name ?? ''} ${proc.Cmd ?? ''} ${proc.ParentName ?? ''} ${proc.ParentCmd ?? ''}`.toLowerCase()
        const isUnityPreview =
          combined.includes('station-game-local') ||
          combined.includes(repoMarker) ||
          ((combined.includes('workerd') || combined.includes('wrangler')) && combined.includes('unity'))
        if (!isUnityPreview) {
          throw new Error(
            `Port ${port} is already in use by PID ${proc.Pid} (${proc.Name ?? 'unknown'}). Stop that process or pass --port <port>.`,
          )
        }
        const targetPid =
          proc.ParentName && /node/i.test(proc.ParentName) && (proc.ParentCmd || '').toLowerCase().includes('wrangler')
            ? proc.ParentPid
            : proc.Pid
        console.log(`[unity] Stopping previous Unity preview server on port ${port} (PID ${targetPid})...`)
        killProcessTree(targetPid)
        if (targetPid !== proc.Pid) killProcessTree(proc.Pid)
      }
      for (let i = 0; i < 20; i++) {
        if (!(await isPortListening(host, port))) return
        await sleep(200)
      }
    }
  }
  if (await isPortListening(host, port)) {
    throw new Error(`Port ${port} is still in use on ${host}. Stop the existing listener or pass --port <port>.`)
  }
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)
}

function printHelp() {
  console.log(
    [
      'Usage: npm start unity [-- --rebuild] [-- --build-only] [-- --port 8787] [-- --configuration Release|Development] [-- --scene StationGameLocal]',
      '',
      'Options:',
      '  --build-only               Build and pack the latest Unity WebGL preview without starting the server.',
      '  --rebuild                  Force an isolated Unity bootstrap + WebGL rebuild even when Unity project inputs match the last verified build.',
      '  --bootstrap                Force scene/catalogue regeneration before building WebGL.',
      '  --port <port>              Local preview port (default: 8787).',
      '  --ip <address>             Local preview bind address (default: 127.0.0.1).',
      '  --scene <name>             Unity scene to build (default: StationGameLocal).',
      '  --configuration <config>   Unity WebGL configuration: Release (default) or Development.',
    ].join('\n'),
  )
}

export async function runUnityDev(argv = process.argv.slice(2)) {
  const options = parseUnityStartArgs(argv)
  if (options.help) {
    printHelp()
    return
  }

  const root = resolve(import.meta.dirname, '../..')
  const sourceUnityDir = join(root, 'unity')
  const isLoopback = options.ip === '127.0.0.1' || options.ip === 'localhost' || options.ip === '::1'
  const useLocalWebPassengers =
    !argv.includes('--scene') &&
    options.scene === 'StationGameLocal' &&
    isLoopback &&
    existsSync(join(sourceUnityDir, 'Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json')) &&
    existsSync(join(sourceUnityDir, 'Assets/StationDesigner/Editor/StationLocalProfile.cs'))
  const buildScenePath = useLocalWebPassengers ? 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity' : null
  const expectedScene = buildScenePath ?? options.scene
  const previewUnityDir = join(root, '.preview/unity')
  const workspaceDir = join(previewUnityDir, 'dev-workspace')
  const devProjectDir = join(workspaceDir, 'project')
  const buildsRoot = join(workspaceDir, 'builds')
  const packsRoot = join(workspaceDir, 'packs')
  const statePath = join(workspaceDir, 'state.json')
  const wranglerConfigPath = join(previewUnityDir, 'station-game-local.jsonc')

  checkNodePin(root)
  const editorPin = readEditorPin(sourceUnityDir)

  mkdirSync(workspaceDir, { recursive: true })
  const state = readWorkspaceState(statePath)

  // Check whether the checked-in demo envelopes in unity/ match game/src/data/*-station.json.
  // If game/src/data changed, we sync to the isolated workspace and export fresh envelopes there.
  const exportDemosScript = join(root, 'tools/unity-parity/export-station-documents.mjs')
  const sourceDemosCheck = existsSync(exportDemosScript)
    ? spawnSync(
        process.execPath,
        [exportDemosScript, '--check', '--out', join(sourceUnityDir, 'Assets/StationDesigner/Demos')],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      )
    : { status: 0 }
  const sourceDemosCurrent = sourceDemosCheck.status === 0

  const sourceRecipes = snapshotDirectoryInputs(sourceUnityDir, ['asset-recipes'])
  const recipeSignature = digestSnapshot(sourceRecipes)
  const demoSourceSignature = digestSnapshot(snapshotDirectoryInputs(root, ['game/src/data', 'tools/unity-parity']))
  const fixtureInputs = snapshotDirectoryInputs(root, ['unity/tests/fixtures'])
  const sourceInputs = snapshotDirectoryInputs(sourceUnityDir, ['Assets', 'Packages', 'ProjectSettings'], {
    ignore: MUTABLE_BUILD_INPUTS,
    includeLocalPassengers: useLocalWebPassengers,
  })
  const sourceSignature = digestSnapshot(sourceInputs)

  let rawBuildDir = null
  if (!options.rebuild && !options.bootstrap) {
    const verifyOpts = {
      inputs: sourceInputs,
      fixtures: fixtureInputs,
      scene: expectedScene,
      configuration: options.configuration,
      editorVersionWithRevision: editorPin.versionWithRevision,
    }
    const signaturesMatchLastBuild =
      Boolean(state.lastBuild?.rawBuildDir) &&
      (!state.lastBuild.recipeSignature || state.lastBuild.recipeSignature === recipeSignature) &&
      (!state.lastBuild.demoSourceSignature || state.lastBuild.demoSourceSignature === demoSourceSignature)

    if (sourceDemosCurrent && signaturesMatchLastBuild) {
      const check = verifyRawBuild(state.lastBuild.rawBuildDir, verifyOpts)
      if (check.ok) rawBuildDir = state.lastBuild.rawBuildDir
    }
    if (
      !rawBuildDir &&
      signaturesMatchLastBuild &&
      state.lastBuild.sourceSignature === sourceSignature &&
      existsSync(devProjectDir)
    ) {
      const devInputs = snapshotDirectoryInputs(devProjectDir, ['Assets', 'Packages', 'ProjectSettings'], {
        ignore: MUTABLE_BUILD_INPUTS,
      })
      const devCheck = verifyRawBuild(state.lastBuild.rawBuildDir, { ...verifyOpts, inputs: devInputs })
      if (devCheck.ok) rawBuildDir = state.lastBuild.rawBuildDir
    }
    if (!rawBuildDir && sourceDemosCurrent) {
      const existing = findExistingVerifiedRawBuild(previewUnityDir, options.configuration, verifyOpts)
      if (existing) {
        rawBuildDir = existing
        state.lastBuild = {
          rawBuildDir,
          sourceSignature,
          recipeSignature,
          demoSourceSignature,
          scene: expectedScene,
          configuration: options.configuration,
          builtAt: new Date().toISOString(),
        }
        writeWorkspaceState(statePath, state)
      }
    }
    if (rawBuildDir) {
      console.log(
        `[unity] Verified WebGL player matches all ${sourceInputs.length} Unity inputs (${relative(root, rawBuildDir).replaceAll('\\', '/')}).`,
      )
    }
  }

  // Even when demos or bootstrap outputs live in devProjectDir, check if devProjectDir itself already matches lastBuild
  if (!rawBuildDir && !options.rebuild && !options.bootstrap && existsSync(devProjectDir) && state.lastBuild?.rawBuildDir) {
    if (!existsSync(editorPin.editorPath) || !existsSync(editorPin.webglModulePath)) {
      throw new Error(`Pinned Unity Editor (${editorPin.versionWithRevision}) or WebGLSupport not found at ${editorPin.editorPath}`)
    }
  }

  if (!rawBuildDir) {
    if (!existsSync(editorPin.editorPath) || !existsSync(editorPin.webglModulePath)) {
      throw new Error(`Pinned Unity Editor (${editorPin.versionWithRevision}) or WebGLSupport not found at ${editorPin.editorPath}`)
    }
    if (existsSync(join(sourceUnityDir, 'Temp/UnityLockfile'))) {
      console.log('[unity] Unity Editor is open on unity/; building cleanly in isolated workspace (.preview/unity/dev-workspace/project).')
    }
    mkdirSync(devProjectDir, { recursive: true })
    if (!existsSync(join(devProjectDir, 'Library/SourceAssetDB'))) {
      const donor = findWarmLibraryDonor(previewUnityDir, sourceUnityDir, devProjectDir)
      if (donor) {
        console.log(`[unity] Seeding warm Unity Library cache from ${relative(root, donor.project).replaceAll('\\', '/')}...`)
        copyTreeIfMissing(donor.library, join(devProjectDir, 'Library'))
      } else {
        console.log('[unity] Initializing fresh isolated Unity Library (first run may take several minutes)...')
      }
    }
    clearStaleProjectLock(devProjectDir)

    console.log('[unity] Syncing Unity project sources to isolated workspace...')
    for (const folder of ['Assets', 'Packages', 'ProjectSettings', 'asset-recipes']) {
      const src = join(sourceUnityDir, folder)
      if (existsSync(src)) mirrorDirectory(src, join(devProjectDir, folder))
    }
    if (!useLocalWebPassengers) {
      // The public build and its exported provenance must exclude the review-only library.
      rmSync(join(devProjectDir, LOCAL_PASSENGER_ROOT), { recursive: true, force: true })
      for (const path of LOCAL_PASSENGER_FILES) rmSync(join(devProjectDir, path), { force: true })
    }
    ensureDemosExported(root, join(devProjectDir, 'Assets/StationDesigner/Demos'))

    const bootstrapInputs = [
      ...sourceRecipes,
      ...snapshotDirectoryInputs(devProjectDir, ['Assets/StationDesigner/Demos', 'Assets/StationDesigner/Editor']),
      { Path: '__scene__', SHA256: expectedScene },
      { Path: '__editor__', SHA256: editorPin.versionWithRevision },
    ]
    const bootstrapSignature = digestSnapshot(bootstrapInputs)
    const sceneAssetPath = join(devProjectDir, `Assets/StationDesigner/Scenes/${options.scene}.unity`)
    const localWebReady =
      !useLocalWebPassengers ||
      (existsSync(join(devProjectDir, buildScenePath)) &&
        existsSync(join(devProjectDir, 'Assets/StationDesigner/Generated/Passengers/passenger-catalogue-web.asset')))
    const needsBootstrap =
      options.rebuild ||
      options.bootstrap ||
      !existsSync(sceneAssetPath) ||
      !localWebReady ||
      !existsSync(join(devProjectDir, 'Assets/StationDesigner/Generated/RuntimeCatalogue.asset')) ||
      !existsSync(join(devProjectDir, 'Assets/StationDesigner/Generated/TrainCatalogue.asset')) ||
      state.lastBootstrapSignature !== bootstrapSignature

    const stamp = timestampId()
    const runBuildOut = join(buildsRoot, `build-${stamp}`)
    mkdirSync(runBuildOut, { recursive: true })

    if (needsBootstrap) {
      if (useLocalWebPassengers) {
        console.log('[unity] Bootstrapping StationGameLocal, local 3D passenger cohort, and StationGameLocalWeb...')
        await runUnityExecuteMethod(editorPin.editorPath, {
          projectPath: devProjectDir,
          logPath: join(runBuildOut, `prepare-local-web-${options.configuration}.log`),
          method: 'Metro.Editor.StationLocalProfile.PrepareLocalWebBuild',
          label: 'prepare-local-web',
        })
      } else {
        console.log(`[unity] Bootstrapping scene ${options.scene} and runtime catalogues...`)
        await runMetroUnityTask(root, 'bootstrap', {
          projectPath: devProjectDir,
          outputDirectory: runBuildOut,
          scene: options.scene,
          configuration: options.configuration,
        })
      }
      state.lastBootstrapSignature = bootstrapSignature
      writeWorkspaceState(statePath, state)
    }

    console.log(`[unity] Building Unity WebGL (${expectedScene}, ${options.configuration})...`)
    await runMetroUnityTask(root, 'build-web', {
      projectPath: devProjectDir,
      outputDirectory: runBuildOut,
      scene: options.scene,
      scenePath: buildScenePath,
      configuration: options.configuration,
    })

    const producedRaw = join(runBuildOut, `web-${options.configuration}`)
    const postBuildInputs = snapshotDirectoryInputs(devProjectDir, ['Assets', 'Packages', 'ProjectSettings'], {
      ignore: MUTABLE_BUILD_INPUTS,
    })
    const verified = verifyRawBuild(producedRaw, {
      inputs: postBuildInputs,
      fixtures: fixtureInputs,
      scene: expectedScene,
      configuration: options.configuration,
      editorVersionWithRevision: editorPin.versionWithRevision,
    })
    if (!verified.ok) throw new Error(`Built WebGL output failed verification: ${verified.reason}`)

    rawBuildDir = producedRaw
    state.lastBuild = {
      rawBuildDir,
      sourceSignature,
      recipeSignature,
      demoSourceSignature,
      scene: expectedScene,
      configuration: options.configuration,
      builtAt: new Date().toISOString(),
    }
    writeWorkspaceState(statePath, state)
  }

  // Always pack a fresh bundle so edits in game/src (React UI, styles, sign painter, thumbnails) are immediately live.
  mkdirSync(packsRoot, { recursive: true })
  const packDir = join(packsRoot, `pack-${timestampId()}`)
  console.log('[unity] Building React UI shell and packing WebGL assets...')
  const packResult = spawnSync(process.execPath, [join(root, 'tools/unity-web/pack.mjs'), rawBuildDir, packDir], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (packResult.status !== 0) {
    throw new Error(`tools/unity-web/pack.mjs failed with exit code ${packResult.status}`)
  }

  const relativePackDir = './' + relative(previewUnityDir, packDir).replaceAll('\\', '/')
  const wranglerConfig = {
    name: 'metro-unity-local',
    main: '../../tools/unity-web/local-worker.mjs',
    compatibility_date: '2026-10-01',
    assets: {
      directory: relativePackDir,
      binding: 'ASSETS',
      run_worker_first: true,
    },
  }
  writeFileSync(wranglerConfigPath, JSON.stringify(wranglerConfig, null, 2) + '\n')

  const previousPackDir = state.activePackedDir
  state.activePackedDir = packDir
  state.updatedAt = new Date().toISOString()
  writeWorkspaceState(statePath, state)

  pruneOldDirectories(buildsRoot, [rawBuildDir ? resolve(rawBuildDir, '..') : null], 1)
  pruneOldDirectories(packsRoot, [packDir, previousPackDir], 1)

  if (options.buildOnly) {
    console.log(`[unity] Build ready: ${relative(root, packDir).replaceAll('\\', '/')}`)
    return
  }

  await releasePreviewPortIfOwned(root, options.ip, options.port)
  const urlHost = options.ip.includes(':') ? `[${options.ip}]` : options.ip
  const baseUrl = `http://${urlHost}:${options.port}`
  console.log(`[unity] Starting local preview on ${baseUrl}/game/ ...`)
  const server = spawn(
    process.execPath,
    [
      join(root, 'tools/unity-web/static-pack-server.mjs'),
      '--pack',
      packDir,
      '--port',
      String(options.port),
      '--ip',
      options.ip,
    ],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    },
  )

  let stopping = false
  const stopServer = (code = 0) => {
    if (stopping) return
    stopping = true
    if (server.exitCode === null) killProcessTree(server.pid)
    setTimeout(() => process.exit(code), 300)
  }
  process.on('SIGINT', () => stopServer(0))
  process.on('SIGTERM', () => stopServer(0))
  server.on('error', error => {
    console.error(`[unity] Preview server error: ${error.message}`)
    stopServer(1)
  })
  server.on('exit', code => {
    if (!stopping) process.exit(code ?? 0)
  })

  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${server.exitCode}`)
    }
    try {
      const res = await fetch(`${baseUrl}/game/`)
      if (res.ok) {
        console.log(
          [
            '',
            `[unity] Preview ready:`,
            `  Player (ZH) : ${baseUrl}/game/`,
            `  Player (EN) : ${baseUrl}/game/en/`,
            `  Demos       : ${baseUrl}/game/zoo | ${baseUrl}/game/tanwei | ${baseUrl}/game/tianhe`,
            '',
          ].join('\n'),
        )
        break
      }
    } catch {}
    await sleep(500)
  }

  await new Promise(() => {})
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runUnityDev().catch(error => {
    console.error(`[unity] ${error.message || error}`)
    process.exit(1)
  })
}
