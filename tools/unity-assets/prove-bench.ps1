param(
    [string]$Editor = $env:METRO_UNITY_EDITOR,
    [switch]$SkipWeb,
    [ValidateSet('bench', 'train', 'bin')][string]$Asset = 'bench'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$source = Join-Path $repo 'unity'
$version = (Select-String -LiteralPath "$source/ProjectSettings/ProjectVersion.txt" -Pattern '^m_EditorVersion: (.+)$').Matches[0].Groups[1].Value
if (!$Editor) {
    $Editor = Join-Path $env:ProgramFiles "Unity/Hub/Editor/$version/Editor/Unity.exe"
}
if (!(Test-Path -LiteralPath $Editor -PathType Leaf)) { throw "Unity $version not found. Pass -Editor." }
if (!$SkipWeb -and !(Test-Path -LiteralPath (Join-Path (Split-Path $Editor) 'Data/PlaybackEngines/WebGLSupport'))) {
    throw 'Install Web Build Support for the pinned editor.'
}

$proof = (New-Item -ItemType Directory -Force (Join-Path $repo ".preview/unity/$Asset-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')")).FullName
$project = (New-Item -ItemType Directory (Join-Path $proof 'project')).FullName
New-Item -ItemType Directory -Force "$project/Assets/Editor" | Out-Null
Copy-Item -LiteralPath "$source/Packages","$source/ProjectSettings" -Destination $project -Recurse
Copy-Item -LiteralPath "$source/Assets/Settings","$source/Assets/Settings.meta" -Destination "$project/Assets" -Recurse
Copy-Item -LiteralPath "$PSScriptRoot/InstallGltf.cs" -Destination "$project/Assets/Editor"
$env:METRO_BENCH_PROOF = $proof
$env:METRO_BENCH_WEB = "$proof/web"

function Invoke-BenchEditor([string]$Method, [string]$Log, [string]$Flags) {
    $arguments = "-batchmode -nographics -projectPath `"$project`" -executeMethod Metro.AssetExample.$Method -logFile `"$proof/$Log`" $Flags"
    $process = Start-Process -FilePath $Editor -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "$Method failed with exit code $($process.ExitCode). See $proof/$Log" }
}

$review = @{ bench = 'ReviewBench'; train = 'ReviewTrain'; bin = 'ReviewBin' }[$Asset]
$assetFolder = @{ bench = 'BenchProof'; train = 'TrainProof'; bin = 'BinProof' }[$Asset]
$prefabName = @{ bench = 'Bench'; train = 'TypeA'; bin = 'Bin' }[$Asset]
$marker = @{ bench = 'BENCH_IMPORT_OK'; train = 'TRAIN_IMPORT_OK'; bin = 'BIN_IMPORT_OK' }[$Asset]
Write-Host "Evidence directory $proof"
node "$PSScriptRoot/export-$Asset.mjs" "$proof/export"
if ($LASTEXITCODE) { throw "$Asset export failed." }
node "$PSScriptRoot/export-$Asset.mjs" "$proof/repeat-export"
if ($LASTEXITCODE) { throw 'Repeat export failed.' }
if ((Get-FileHash "$proof/export/$Asset.glb").Hash -ne (Get-FileHash "$proof/repeat-export/$Asset.glb").Hash) {
    throw 'Repeat export changed GLB bytes.'
}

Invoke-BenchEditor 'InstallGltf.Run' 'install.log' ''
Copy-Item -LiteralPath "$PSScriptRoot/$review.cs" -Destination "$project/Assets/Editor"
Invoke-BenchEditor "$review.Import" 'import.log' '-quit'
$modelMeta = "$project/Assets/$assetFolder/$Asset.glb.meta"
$prefab = "$project/Assets/$assetFolder/$prefabName.prefab"
$before = (Get-FileHash $modelMeta,$prefab,"$prefab.meta").Hash
Invoke-BenchEditor "$review.Import" 'repeat-import.log' '-quit'
$after = (Get-FileHash $modelMeta,$prefab,"$prefab.meta").Hash
if (Compare-Object $before $after -SyncWindow 0) { throw 'Repeat import changed the model metadata or prefab.' }
Select-String -LiteralPath "$proof/repeat-import.log" -Pattern $marker

if (!$SkipWeb) {
    Invoke-BenchEditor "$review.BuildWeb" 'web.log' '-buildTarget WebGL -quit'
    node "$PSScriptRoot/check-web.mjs" $proof $Asset
    if ($LASTEXITCODE) { throw 'Web review failed.' }
}
