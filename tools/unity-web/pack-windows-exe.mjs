// Package a Unity StandaloneWindows64 player directory (`windows-Release/`)
// plus a self-contained `MetroEditorWebView.exe` into ONE standalone portable
// `StationDesigner.exe` with zero external DLL, folder, or .NET runtime dependencies.
//
// Usage:
//   node tools/unity-web/pack-windows-exe.mjs <player-dir> <output-exe>
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const FOOTER_MAGIC = Buffer.from('METRO_BUNDLE_V1\0', 'ascii')

function run(cmd, args, label, opts = {}) {
  console.log(`[unity-win-pack] ${label}...`)
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

function stripDebugDocs(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) stripDebugDocs(full)
    else if (/\.(pdb|xml)$/i.test(entry.name)) rmSync(full, { force: true })
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest()
}

export async function packWindowsExe(repoRoot, playerDir, outputExe) {
  const repo = resolve(repoRoot)
  const srcPlayer = resolve(playerDir)
  const outExe = resolve(outputExe)
  if (!existsSync(join(srcPlayer, 'MetroStation.exe')) || !existsSync(join(srcPlayer, 'UnityPlayer.dll'))) {
    throw new Error(`Incomplete Unity Windows player directory: ${srcPlayer}`)
  }

  const workspace = join(repo, '.preview/unity/win-workspace')
  const selfContainedWebViewDir = join(workspace, 'webview-selfcontained')
  const launcherPublishDir = join(workspace, 'launcher/publish')
  const stageDir = join(workspace, `bundle-stage-${process.pid}`)
  const zipPath = join(workspace, `bundle-payload-${process.pid}.zip`)

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
    stripDebugDocs(selfContainedWebViewDir)

    // 2. Publish trimmed single-file StationDesigner launcher stub (~8 MB).
    rmSync(launcherPublishDir, { recursive: true, force: true })
    run('dotnet', [
      'publish',
      join(repo, 'tools/unity-windows-bundle/StationDesignerLauncher.csproj'),
      '-c', 'Release',
      '-r', 'win-x64',
      '-o', launcherPublishDir,
    ], 'Publishing single-file StationDesigner launcher stub', { cwd: repo })
    const stubExe = join(launcherPublishDir, 'StationDesigner.exe')
    if (!existsSync(stubExe)) throw new Error(`Missing published launcher stub: ${stubExe}`)

    // 3. Stage clean player tree with self-contained MetroUi/bin and without Backup folder.
    console.log('[unity-win-pack] Staging clean self-contained player tree...')
    rmSync(stageDir, { recursive: true, force: true })
    robocopy(srcPlayer, stageDir, ['/E', '/MT:16', '/XD', 'MetroStation_BackUpThisFolder_ButDontShipItWithYourGame'])
    const stagedWebViewBin = join(stageDir, 'MetroStation_Data/StreamingAssets/MetroUi/bin')
    rmSync(stagedWebViewBin, { recursive: true, force: true })
    robocopy(selfContainedWebViewDir, stagedWebViewBin, ['/E', '/MT:16'])

    // 4. Create compressed zip payload via .NET System.IO.Compression.ZipFile.
    rmSync(zipPath, { force: true })
    const psZip = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:METRO_STAGE_DIR, $env:METRO_ZIP_PATH, [System.IO.Compression.CompressionLevel]::Optimal, $false)`
    run('powershell', ['-NoProfile', '-Command', psZip], 'Compressing player payload archive', {
      cwd: repo,
      env: { ...process.env, METRO_STAGE_DIR: stageDir, METRO_ZIP_PATH: zipPath },
    })

    // 5. Concatenate [launcher stub] + [payload.zip] + [56-byte footer] -> outputExe.
    console.log(`[unity-win-pack] Assembling single-file executable ${outExe}...`)
    mkdirSync(dirname(outExe), { recursive: true })
    const tmpExe = `${outExe}.tmp-${process.pid}`
    rmSync(tmpExe, { force: true })

    const stubSize = statSync(stubExe).size
    const zipSize = statSync(zipPath).size
    const zipHash = await sha256File(zipPath)
    const footer = Buffer.alloc(56)
    FOOTER_MAGIC.copy(footer, 0)
    footer.writeBigInt64LE(BigInt(stubSize), 16)
    footer.writeBigInt64LE(BigInt(zipSize), 24)
    zipHash.subarray(0, 16).copy(footer, 32)
    footer.writeBigInt64LE(1n, 48)

    const out = createWriteStream(tmpExe)
    await pipeline(createReadStream(stubExe), out, { end: false })
    await pipeline(createReadStream(zipPath), out, { end: false })
    await new Promise((resolveDone, rejectDone) => {
      out.end(footer, err => (err ? rejectDone(err) : resolveDone()))
    })

    rmSync(outExe, { force: true })
    copyFileSync(tmpExe, outExe)
    rmSync(tmpExe, { force: true })
    // Clear any inherited Low Mandatory Integrity Label from sandboxed repo folders so
    // Windows launches StationDesigner.exe at normal Medium integrity (required by Unity
    // Windows.Gaming.Input, D3D12, %TEMP%/%LOCALAPPDATA% writes, and WebView2).
    if (process.platform === 'win32') {
      spawnSync('icacls', [outExe, '/setintegritylevel', 'Medium'], { windowsHide: true })
    }

    // 6. Verify the single-file .exe boots and validates its own embedded bundle.
    // On non-interactive Win32 runners (0xC0000142), fall back to running the exact same
    // launcher assembly via `dotnet <StationDesigner.dll> --bundle-verify --bundle-file <exe>`.
    console.log('[unity-win-pack] Verifying single-file bundle integrity...')
    let verify = spawnSync(outExe, ['--bundle-verify'], { encoding: 'utf8', windowsHide: true })
    if (verify.error) throw verify.error
    if (verify.status === 0xC0000142) {
      const launcherDll = join(workspace, 'launcher/bin/StationDesigner.dll')
      console.log('[unity-win-pack] Non-interactive shell (0xC0000142 on WinExe); verifying bundle via dotnet StationDesigner.dll...')
      verify = spawnSync('dotnet', [launcherDll, '--bundle-verify', '--bundle-file', outExe], { encoding: 'utf8', windowsHide: true })
      if (verify.error) throw verify.error
    }
    if (verify.status !== 0) {
      throw new Error(`StationDesigner.exe --bundle-verify failed (${verify.status}):\n${verify.stdout}\n${verify.stderr}`)
    }
    const verifyJson = JSON.parse(verify.stdout.trim())
    if (!verifyJson.ok) throw new Error(`Bundle verification returned ok=false: ${verify.stdout}`)

    const totalBytes = statSync(outExe).size
    console.log(
      `[unity-win-pack] Verified single-file exe: ${(totalBytes / (1024 * 1024)).toFixed(1)} MB ` +
      `(stub ${(stubSize / (1024 * 1024)).toFixed(1)} MB + payload ${(zipSize / (1024 * 1024)).toFixed(1)} MB, ` +
      `${verifyJson.files} files, bundleId=${verifyJson.bundleId})`,
    )
    return { outputExe: outExe, totalBytes, stubSize, zipSize, verify: verifyJson }
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
    rmSync(zipPath, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = resolve(import.meta.dirname, '../..')
  const [playerDir, outputExe] = process.argv.slice(2)
  if (!playerDir || !outputExe) {
    console.error('Usage: node tools/unity-web/pack-windows-exe.mjs <player-dir> <output-exe>')
    process.exit(1)
  }
  await packWindowsExe(repo, playerDir, outputExe)
}
