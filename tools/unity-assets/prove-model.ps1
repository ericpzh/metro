# Generic proof runner for one model family.
#
# A family owns three files next to this script:
#   export-<family>.mjs  writes <variant>.glb + manifest/validation JSON
#   Review<Family>.cs    Metro.AssetExample.Review<Family>.Import() / .BuildWeb()
#   check-web-<family>.mjs  screenshots the built Web review
#
# The runner copies the pinned Unity project to a scratch root (D: by default,
# because the repo drive is nearly full), imports the exported GLBs twice,
# rejects any change on the second import, builds and pixel-checks Web, promotes
# the verified GLBs, prefabs and review scenes into unity/Assets, and finally
# deletes its .preview evidence and the scratch project. Pass -KeepEvidence to
# keep them; -SkipPromote implies -KeepEvidence so un-promoted work is not lost.
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]*$')][string]$Family,
    [string]$Editor = $env:METRO_UNITY_EDITOR,
    [switch]$SkipWeb,
    [switch]$SkipPromote,
    [switch]$KeepEvidence,
    [string]$ScratchRoot = 'D:\metro-unity-scratch'
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

$class = (Get-Culture).TextInfo.ToTitleCase($Family)
$review = "Review$class"
$marker = $Family.ToUpperInvariant() + '_IMPORT_OK'
$export = Join-Path $PSScriptRoot "export-$Family.mjs"
$reviewSource = Join-Path $PSScriptRoot "$review.cs"
$webCheck = Join-Path $PSScriptRoot "check-web-$Family.mjs"
foreach ($required in @($export, $reviewSource)) {
    if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing family file: $required" }
}
if (!$SkipWeb -and !(Test-Path -LiteralPath $webCheck -PathType Leaf)) { throw "Missing family Web check: $webCheck" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$proof = (New-Item -ItemType Directory -Force (Join-Path $repo ".preview/unity/$Family-$stamp")).FullName
$project = (New-Item -ItemType Directory -Force (Join-Path $ScratchRoot "$Family-$stamp")).FullName
New-Item -ItemType Directory -Force "$project/Assets/Editor" | Out-Null
Copy-Item -LiteralPath "$source/Packages", "$source/ProjectSettings" -Destination $project -Recurse
New-Item -ItemType Directory -Force "$project/Assets" | Out-Null
Copy-Item -LiteralPath "$source/Assets/Settings", "$source/Assets/Settings.meta" -Destination "$project/Assets" -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'InstallGltf.cs') -Destination "$project/Assets/Editor"
Copy-Item -LiteralPath $reviewSource -Destination "$project/Assets/Editor"
$env:METRO_BENCH_PROOF = $proof
$env:METRO_BENCH_WEB = "$proof/web"

function Invoke-FamilyEditor([string]$Method, [string]$Log, [string]$Flags) {
    $arguments = "-batchmode -nographics -projectPath `"$project`" -executeMethod Metro.AssetExample.$Method -logFile `"$proof/$Log`" $Flags"
    $process = Start-Process -FilePath $Editor -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "$Method failed with exit code $($process.ExitCode). See $proof/$Log" }
}

Write-Host "Family $Family -> $project"
Write-Host "Evidence directory $proof"
node $export "$proof/export"
if ($LASTEXITCODE) { throw "$Family export failed." }
node $export "$proof/repeat-export"
if ($LASTEXITCODE) { throw 'Repeat export failed.' }
$first = Get-ChildItem -LiteralPath "$proof/export" -Filter *.glb | Sort-Object Name
if ($first.Count -eq 0) { throw 'Exporter wrote no GLB files.' }
foreach ($file in $first) {
    $repeat = Join-Path "$proof/repeat-export" $file.Name
    if (!(Test-Path -LiteralPath $repeat)) { throw "Repeat export is missing $($file.Name)" }
    if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $repeat).Hash) {
        throw "Repeat export changed $($file.Name)."
    }
}

Invoke-FamilyEditor 'InstallGltf.Run' 'install.log' ''
$folder = "$project/Assets/${class}Proof"
function Get-FamilyFingerprint {
    if (!(Test-Path -LiteralPath $folder)) { return '' }
    # Unity mints fresh fileIDs for runtime-created scene objects on every save,
    # so scene payloads are not byte-stable by design. Prefab, model and metadata
    # bytes still have to be identical after the second import; the scene's
    # content is checked by the review script itself on every run.
    ((Get-ChildItem -LiteralPath $folder -Recurse -File |
        Where-Object { $_.Extension -in @('.glb', '.prefab', '.meta') } |
        Sort-Object FullName |
        ForEach-Object { "$(Split-Path $_.FullName -Leaf)=$((Get-FileHash -LiteralPath $_.FullName).Hash)" }) -join "`n")
}
Invoke-FamilyEditor "$review.Import" 'import.log' '-quit'
$before = Get-FamilyFingerprint
if (!$before) { throw "$review.Import produced no assets under Assets/${class}Proof" }
Invoke-FamilyEditor "$review.Import" 'repeat-import.log' '-quit'
$after = Get-FamilyFingerprint
if ($before -ne $after) { throw 'Repeat import changed the imported model metadata or wrapper assets.' }
$markerHit = Select-String -LiteralPath "$proof/repeat-import.log" -Pattern $marker
if (!$markerHit) { throw "The repeat import log does not contain $marker" }
$markerHit | ForEach-Object { Write-Host $_.Line }

if (!$SkipWeb) {
    Invoke-FamilyEditor "$review.BuildWeb" 'web.log' '-buildTarget WebGL -quit'
    node $webCheck $proof
    if ($LASTEXITCODE) { throw 'Web review failed.' }
}

if ($SkipPromote) {
    # Un-promoted scratch is kept: there is nothing in unity/Assets to inspect yet.
    $KeepEvidence = $true
    Write-Host "Skipping promotion; keeping evidence and scratch for inspection."
} else {
    & (Join-Path $PSScriptRoot 'promote-family.ps1') -Family $Family -Project $project
}

function Remove-Tree([string]$Path) {
    if (!(Test-Path -LiteralPath $Path)) { return }
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        cmd /c rd /s /q "$Path" 2>$null
        if (!(Test-Path -LiteralPath $Path)) { return }
        Start-Sleep -Seconds 2
    }
    throw "Could not remove $Path"
}

if (!$KeepEvidence) {
    $proofFull = [IO.Path]::GetFullPath($proof)
    $scratchFull = [IO.Path]::GetFullPath($project)
    $proofRoot = [IO.Path]::GetFullPath((Join-Path $repo '.preview/unity')) + [IO.Path]::DirectorySeparatorChar
    $scratchRootFull = [IO.Path]::GetFullPath($ScratchRoot) + [IO.Path]::DirectorySeparatorChar
    if (!($proofFull.StartsWith($proofRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $proofFull -Leaf).StartsWith("$Family-", [StringComparison]::OrdinalIgnoreCase))) {
        throw "Refusing to delete an unexpected proof path: $proofFull"
    }
    if (!($scratchFull.StartsWith($scratchRootFull, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $scratchFull -Leaf).StartsWith("$Family-", [StringComparison]::OrdinalIgnoreCase))) {
        throw "Refusing to delete an unexpected scratch path: $scratchFull"
    }
    Remove-Tree $proofFull
    Remove-Tree $scratchFull
    if ((Get-ChildItem -LiteralPath $ScratchRoot -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
        Remove-Item -LiteralPath $ScratchRoot -Force
    }
    Write-Host "CLEANED preview $proofFull"
    Write-Host "CLEANED scratch $scratchFull"
}

Write-Host "PROOF_OK $Family"
if ($KeepEvidence) {
    Write-Host "Evidence $proof"
    Write-Host "Scratch project $project"
} else {
    Write-Host "Assets promoted under unity/Assets/StationDesigner/Generated; preview and scratch removed."
}
