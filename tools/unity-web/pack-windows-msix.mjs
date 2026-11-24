// Package a Unity StandaloneWindows64 player directory (`windows-Release/`)
// plus self-contained `MetroEditorWebView.exe` into a Microsoft Store-ready
// `.msix` package (with Store tile assets, `AppxManifest.xml`, and `resources.pri`).
//
// The Store `.msix` is intentionally unsigned because Microsoft Partner Center
// re-signs MSIX submissions with Microsoft's trusted Store certificate.
// Pass `--dev-sign` to also create a locally self-signed `.msix` for sideload testing.
//
// Usage:
//   node tools/unity-web/pack-windows-msix.mjs <player-dir> [output-msix] [--version 1.0.0.0] [--identity <json>] [--dev-sign] [--allow-local-passengers]
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
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SDK_BUILD_TOOLS_VERSION = '10.0.26100.1742'
const DEFAULT_IDENTITY_REL = '.preview/unity/msix-identity.local.json'

function run(cmd, args, label, opts = {}) {
  console.log(`[unity-msix] ${label}...`)
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

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function normalizeMsixVersion(version) {
  const raw = String(version || '').trim()
  const parts = raw.split('.')
  if (parts.length < 3 || parts.length > 4) {
    throw new Error(`Invalid MSIX version "${raw}": expected Major.Minor.Build.Revision (e.g. 1.0.0.0)`)
  }
  const nums = parts.map(p => {
    if (!/^\d+$/.test(p)) throw new Error(`Invalid MSIX version component "${p}" in "${raw}"`)
    const n = Number(p)
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error(`MSIX version component out of 0..65535 range in "${raw}"`)
    }
    return n
  })
  while (nums.length < 4) nums.push(0)
  // Store requires the 4th segment (Revision) to be 0 for Store-managed submissions.
  return nums.join('.')
}

export function loadMsixIdentity(repoRoot, options = {}) {
  const repo = resolve(repoRoot)
  const filePath = options.identityPath
    ? resolve(repo, options.identityPath)
    : process.env.METRO_MSIX_IDENTITY_FILE
      ? resolve(repo, process.env.METRO_MSIX_IDENTITY_FILE)
      : join(repo, DEFAULT_IDENTITY_REL)

  let fileData = {}
  if (existsSync(filePath)) {
    fileData = JSON.parse(readFileSync(filePath, 'utf8'))
  } else if (options.identityPath) {
    throw new Error(`MSIX identity file not found: ${filePath}`)
  }

  const name = (options.name || process.env.METRO_MSIX_NAME || fileData.name || '').trim()
  const publisher = (options.publisher || process.env.METRO_MSIX_PUBLISHER || fileData.publisher || '').trim()
  const publisherDisplayName = (
    options.publisherDisplayName ||
    process.env.METRO_MSIX_PUBLISHER_DISPLAY_NAME ||
    fileData.publisherDisplayName ||
    ''
  ).trim()
  const displayName = (options.displayName || process.env.METRO_MSIX_DISPLAY_NAME || fileData.displayName || 'Station Designer').trim()
  const description = (
    options.description ||
    process.env.METRO_MSIX_DESCRIPTION ||
    fileData.description ||
    '3D metro station design and live passenger flow sandbox.'
  ).trim()
  const version = normalizeMsixVersion(options.version || process.env.METRO_MSIX_VERSION || fileData.version || '1.0.0.0')

  if (!name || !publisher || !publisherDisplayName) {
    throw new Error(
      `Missing Microsoft Store MSIX identity fields (name, publisher, publisherDisplayName).\n` +
      `Create ${DEFAULT_IDENTITY_REL} (see tools/unity-web/msix-identity.example.json) or set METRO_MSIX_NAME / METRO_MSIX_PUBLISHER / METRO_MSIX_PUBLISHER_DISPLAY_NAME.`,
    )
  }
  if (!/^CN=/i.test(publisher)) {
    throw new Error(`Invalid MSIX Publisher "${publisher}": expected X.500 DN starting with "CN="`)
  }
  return { name, publisher, publisherDisplayName, displayName, description, version, sourcePath: existsSync(filePath) ? filePath : null }
}

export function renderAppxManifest(identity, { executable = 'MetroStation.exe', backgroundColor = '#0c1624' } = {}) {
  const version = normalizeMsixVersion(identity.version)
  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">

  <Identity
    Name="${escapeXml(identity.name)}"
    Publisher="${escapeXml(identity.publisher)}"
    Version="${escapeXml(version)}"
    ProcessorArchitecture="x64" />

  <Properties>
    <DisplayName>${escapeXml(identity.displayName)}</DisplayName>
    <PublisherDisplayName>${escapeXml(identity.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>

  <Resources>
    <Resource Language="en-US" />
    <Resource Language="zh-CN" />
  </Resources>

  <Applications>
    <Application
      Id="StationDesigner"
      Executable="${escapeXml(executable)}"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="${escapeXml(identity.displayName)}"
        Description="${escapeXml(identity.description)}"
        BackgroundColor="${escapeXml(backgroundColor)}"
        Square150x150Logo="Assets\\Square150x150Logo.png"
        Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile
          Wide310x150Logo="Assets\\Wide310x150Logo.png"
          Square310x310Logo="Assets\\Square310x310Logo.png">
          <uap:ShowNameOnTiles>
            <uap:ShowOn Tile="square150x150Logo" />
            <uap:ShowOn Tile="wide310x150Logo" />
            <uap:ShowOn Tile="square310x310Logo" />
          </uap:ShowNameOnTiles>
        </uap:DefaultTile>
      </uap:VisualElements>
    </Application>
  </Applications>

  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
`
}

function findToolInTree(rootDir, fileName) {
  if (!existsSync(rootDir)) return null
  const hits = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.toLowerCase() === fileName.toLowerCase() && /[\\/]x64[\\/]/i.test(full)) {
        hits.push(full)
      }
    }
  }
  walk(rootDir)
  hits.sort()
  return hits.length > 0 ? hits[hits.length - 1] : null
}

export function resolveWindowsSdkTools(repoRoot) {
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    join(homedir(), '.nuget', 'packages', 'microsoft.windows.sdk.buildtools'),
  ]
  const findAll = () => {
    for (const root of roots) {
      const makeappx = findToolInTree(root, 'makeappx.exe')
      const makepri = findToolInTree(root, 'makepri.exe')
      const signtool = findToolInTree(root, 'signtool.exe')
      if (makeappx && makepri && signtool) return { makeappx, makepri, signtool }
    }
    return null
  }

  let found = findAll()
  if (found) return found

  // Auto-restore Microsoft.Windows.SDK.BuildTools into NuGet cache via dotnet (no admin required).
  const toolsProjectDir = join(resolve(repoRoot), '.preview/unity/win-workspace/sdk-tools')
  mkdirSync(toolsProjectDir, { recursive: true })
  const csproj = join(toolsProjectDir, 'SdkTools.csproj')
  writeFileSync(
    csproj,
    `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Microsoft.Windows.SDK.BuildTools" Version="${SDK_BUILD_TOOLS_VERSION}" />\n  </ItemGroup>\n</Project>\n`,
    'utf8',
  )
  run('dotnet', ['restore', csproj, '--verbosity', 'minimal'], 'Restoring Microsoft.Windows.SDK.BuildTools via NuGet', { cwd: repoRoot })
  found = findAll()
  if (!found) {
    throw new Error('Could not locate makeappx.exe / makepri.exe / signtool.exe after NuGet restore.')
  }
  return found
}

function generateMsixTileAssets(sourceIconPng, assetsDir) {
  mkdirSync(assetsDir, { recursive: true })
  // Generate all required Store + taskbar scale/targetsize variants directly from the
  // approved 512x512 brand icon using System.Drawing HighQualityBicubic resampling.
  const psScript = `
Add-Type -AssemblyName System.Drawing
$srcPath = $env:METRO_ICON_SRC
$outDir = $env:METRO_ASSETS_DIR
$src = [System.Drawing.Image]::FromFile($srcPath)
try {
  $srcBmp = New-Object System.Drawing.Bitmap($src)
  try {
    $bg = $srcBmp.GetPixel(2, 2)
    function Save-Tile([string]$name, [int]$w, [int]$h, [bool]$padWide) {
      $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          if ($padWide) {
            $g.Clear($bg)
            $side = [int][Math]::Round([Math]::Min($w, $h) * 0.84)
            $x = [int][Math]::Floor(($w - $side) / 2.0)
            $y = [int][Math]::Floor(($h - $side) / 2.0)
            $g.DrawImage($srcBmp, $x, $y, $side, $side)
          } else {
            $g.DrawImage($srcBmp, 0, 0, $w, $h)
          }
        } finally { $g.Dispose() }
        $bmp.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $bmp.Dispose() }
    }

    Save-Tile 'StoreLogo.scale-100.png' 50 50 $false
    Save-Tile 'StoreLogo.scale-200.png' 100 100 $false
    Save-Tile 'StoreLogo.scale-400.png' 200 200 $false

    Save-Tile 'Square44x44Logo.scale-100.png' 44 44 $false
    Save-Tile 'Square44x44Logo.scale-200.png' 88 88 $false
    Save-Tile 'Square44x44Logo.scale-400.png' 176 176 $false
    foreach ($sz in @(16, 24, 32, 48, 256)) {
      Save-Tile ("Square44x44Logo.targetsize-$sz.png") $sz $sz $false
      Save-Tile ("Square44x44Logo.altform-unplated_targetsize-$sz.png") $sz $sz $false
    }

    Save-Tile 'Square150x150Logo.scale-100.png' 150 150 $false
    Save-Tile 'Square150x150Logo.scale-200.png' 300 300 $false

    Save-Tile 'Wide310x150Logo.scale-100.png' 310 150 $true
    Save-Tile 'Wide310x150Logo.scale-200.png' 620 300 $true

    Save-Tile 'Square310x310Logo.scale-100.png' 310 310 $false
    Save-Tile 'Square310x310Logo.scale-200.png' 620 620 $false
  } finally { $srcBmp.Dispose() }
} finally { $src.Dispose() }
`
  run('powershell', ['-NoProfile', '-Command', psScript], 'Generating MSIX Store tile PNGs from approved brand icon', {
    env: { ...process.env, METRO_ICON_SRC: sourceIconPng, METRO_ASSETS_DIR: assetsDir },
  })
}

function generateResourcesPri(makepriExe, stageDir, identityName, workspace) {
  const priConfig = join(workspace, `priconfig-${process.pid}.xml`)
  const priLog = join(workspace, `makepri-${process.pid}`)
  const assetsOnlyDir = join(workspace, `pri-assets-${process.pid}`)
  try {
    rmSync(priConfig, { force: true })
    rmSync(assetsOnlyDir, { recursive: true, force: true })
    // Copy only Assets/ + AppxManifest.xml into a lightweight index root so makepri
    // builds a clean resource map for scale/targetsize visual assets without scanning
    // hundreds of Unity/WebView2 binaries.
    mkdirSync(assetsOnlyDir, { recursive: true })
    copyFileSync(join(stageDir, 'AppxManifest.xml'), join(assetsOnlyDir, 'AppxManifest.xml'))
    robocopy(join(stageDir, 'Assets'), join(assetsOnlyDir, 'Assets'), ['/E'])

    run(makepriExe, ['createconfig', '/cf', priConfig, '/dq', 'en-US_scale-200', '/o'], 'Creating MakePri configuration')
    // Remove <packaging> auto-split block so a single unified resources.pri indexes all
    // scales (100/200/400 + targetsize) instead of emitting split resources.scale-*.pri files
    // that belong only in multi-package .msixbundle resource packs.
    const cfgXml = readFileSync(priConfig, 'utf8').replace(/<packaging>[\s\S]*?<\/packaging>/i, '')
    writeFileSync(priConfig, cfgXml, 'utf8')
    run(
      makepriExe,
      [
        'new',
        '/pr', assetsOnlyDir,
        '/cf', priConfig,
        '/mn', join(assetsOnlyDir, 'AppxManifest.xml'),
        '/in', identityName,
        '/of', join(stageDir, 'resources.pri'),
        '/o',
      ],
      'Generating unified resources.pri for MSIX visual assets',
    )
  } finally {
    rmSync(priConfig, { force: true })
    rmSync(priLog, { recursive: true, force: true })
    rmSync(assetsOnlyDir, { recursive: true, force: true })
  }
}

function devSignMsix(signtoolExe, unsignedMsix, signedMsix, publisher, workspace) {
  const certDir = join(workspace, 'msix-dev-cert')
  mkdirSync(certDir, { recursive: true })
  const pfxPath = join(certDir, 'dev-sign.pfx')
  const cerPath = join(certDir, 'dev-sign.cer')
  const pwd = 'metro-local-dev-cert'

  const psCert = `
$subj = $env:METRO_CERT_SUBJECT
$pfx = $env:METRO_CERT_PFX
$cer = $env:METRO_CERT_CER
$sec = ConvertTo-SecureString -String $env:METRO_CERT_PWD -Force -AsPlainText
$existing = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq $subj -and $_.HasPrivateKey } | Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $existing) {
  $existing = New-SelfSignedCertificate -Type Custom -Subject $subj -KeyUsage DigitalSignature -FriendlyName "Station Designer Local Dev MSIX" -CertStoreLocation "Cert:\\CurrentUser\\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
}
Export-PfxCertificate -Cert $existing -FilePath $pfx -Password $sec | Out-Null
Export-Certificate -Cert $existing -FilePath $cer | Out-Null
Write-Output $existing.Thumbprint
`
  run('powershell', ['-NoProfile', '-Command', psCert], 'Preparing local self-signed dev certificate', {
    env: {
      ...process.env,
      METRO_CERT_SUBJECT: publisher,
      METRO_CERT_PFX: pfxPath,
      METRO_CERT_CER: cerPath,
      METRO_CERT_PWD: pwd,
    },
  })

  copyFileSync(unsignedMsix, signedMsix)
  run(
    signtoolExe,
    ['sign', '/fd', 'SHA256', '/a', '/f', pfxPath, '/p', pwd, signedMsix],
    'Signing local dev-test MSIX with self-signed certificate',
  )
  return { signedMsix, cerPath }
}

export async function packWindowsMsix(repoRoot, playerDir, outputMsix, options = {}) {
  const repo = resolve(repoRoot)
  const srcPlayer = resolve(playerDir)
  if (!existsSync(join(srcPlayer, 'MetroStation.exe')) || !existsSync(join(srcPlayer, 'UnityPlayer.dll'))) {
    throw new Error(`Incomplete Unity Windows player directory: ${srcPlayer}`)
  }

  const identity = loadMsixIdentity(repo, options)
  const outMsix = resolve(outputMsix || join(repo, `.preview/unity/StationDesigner-${identity.version}-x64.msix`))
  const sourceIcon = join(repo, 'design/icon/station-designer-blue-bold.png')
  if (!existsSync(sourceIcon)) throw new Error(`Missing approved brand icon: ${sourceIcon}`)

  const sdk = resolveWindowsSdkTools(repo)
  const workspace = join(repo, '.preview/unity/win-workspace')
  const selfContainedWebViewDir = join(workspace, 'webview-selfcontained')
  const stageDir = join(workspace, `msix-stage-${process.pid}`)

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

    // 2. Stage clean player tree without Backup folder and with self-contained MetroUi/bin.
    console.log('[unity-msix] Staging clean self-contained MSIX payload...')
    rmSync(stageDir, { recursive: true, force: true })
    robocopy(srcPlayer, stageDir, ['/E', '/MT:16', '/XD', 'MetroStation_BackUpThisFolder_ButDontShipItWithYourGame'])
    const stagedWebViewBin = join(stageDir, 'MetroStation_Data/StreamingAssets/MetroUi/bin')
    rmSync(stagedWebViewBin, { recursive: true, force: true })
    robocopy(selfContainedWebViewDir, stagedWebViewBin, ['/E', '/MT:16'])
    stripDebugDocs(stageDir)

    // 3. Enforce public passenger-profile separation before packing for Microsoft Store.
    if (!options.allowLocalPassengers) {
      run(
        process.execPath,
        [join(repo, 'unity/tests/passenger-profile.test.mjs'), '--pack', stageDir],
        'Verifying public-pack passenger isolation on MSIX staging tree',
        { cwd: repo },
      )
    }

    // 4. Generate visual tile assets, AppxManifest.xml, and resources.pri.
    generateMsixTileAssets(sourceIcon, join(stageDir, 'Assets'))
    writeFileSync(join(stageDir, 'AppxManifest.xml'), renderAppxManifest(identity), 'utf8')
    generateResourcesPri(sdk.makepri, stageDir, identity.name, workspace)

    // 5. Pack unsigned Store-ready .msix via MakeAppx.exe.
    mkdirSync(dirname(outMsix), { recursive: true })
    rmSync(outMsix, { force: true })
    run(sdk.makeappx, ['pack', '/o', '/d', stageDir, '/p', outMsix], `Packing Microsoft Store MSIX (${identity.version})`)

    const sizeBytes = statSync(outMsix).size
    console.log(
      `[unity-msix] Store-ready unsigned MSIX created: ${outMsix} (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
    )

    let devSigned = null
    if (options.devSign) {
      const signedPath = outMsix.replace(/\.msix$/i, '.dev-signed.msix')
      devSigned = devSignMsix(sdk.signtool, outMsix, signedPath, identity.publisher, workspace)
      console.log(`[unity-msix] Dev-signed sideload test MSIX: ${devSigned.signedMsix}`)
      console.log(`[unity-msix] Dev cert (trust in LocalMachine\\TrustedPeople to sideload): ${devSigned.cerPath}`)
    }

    return { outputMsix: outMsix, sizeBytes, identity, devSigned }
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
    if (args[i] === '--version' && i + 1 < args.length) opts.version = args[++i]
    else if (args[i] === '--identity' && i + 1 < args.length) opts.identityPath = args[++i]
    else if (args[i] === '--dev-sign') opts.devSign = true
    else if (args[i] === '--allow-local-passengers') opts.allowLocalPassengers = true
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node tools/unity-web/pack-windows-msix.mjs <player-dir> [output-msix] [--version 1.0.0.0] [--identity <json>] [--dev-sign]')
      process.exit(0)
    } else {
      positional.push(args[i])
    }
  }
  const [playerDir, outputMsix] = positional
  if (!playerDir) {
    console.error('Usage: node tools/unity-web/pack-windows-msix.mjs <player-dir> [output-msix] [--version 1.0.0.0] [--identity <json>] [--dev-sign]')
    process.exit(1)
  }
  await packWindowsMsix(repo, playerDir, outputMsix, opts)
}
