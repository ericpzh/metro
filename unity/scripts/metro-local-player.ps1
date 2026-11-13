# Local-only WebGL passenger profile for the Station Designer (plan 11 H3).
#
# Builds `Scenes/StationGameLocalWeb.unity` — the public scene plus an anchor bound
# to the small cohort catalogue (`Generated/Passengers/passenger-catalogue-web.asset`,
# INTERNAL_REVIEW_ONLY) — into a WebGL pack and serves it on loopback only.
#
# This script is deliberately NOT one of the public build inputs:
# `unity/tests/passenger-profile.test.mjs` asserts that `metro-unity.ps1`,
# `BuildWeb.cs`, `StationGameScene.cs`, `ZooPlayable.cs` and `unity-ui-pack.mjs`
# never name the local profile. Keeping the local invocation here means the public
# build cannot produce this pack by accident.
#
# It never publishes: the pack is served by `tools/unity-web/static-pack-server.mjs`
# on 127.0.0.1 and must not be uploaded anywhere (the source library is
# INTERNAL_REVIEW_ONLY and its production rig is blocked).
#
# Prerequisites (run once in an Editor that can see the internal library):
#   -executeMethod Metro.Editor.PassengerCatalogueBuilder.BuildWebCohortMenu
#   -executeMethod Metro.Editor.StationLocalProfile.GenerateWeb
#
# Example:
#   ./unity/scripts/metro-local-player.ps1 -Serve -Port 8801
#   ./unity/scripts/metro-local-player.ps1 -ProjectPath .preview/unity/dev-workspace/project -OutputDirectory .preview/unity/local-web
[CmdletBinding()]
param(
    [string]$ProjectPath,
    [string]$OutputDirectory,
    [ValidateSet('Development', 'Release')][string]$Configuration = 'Release',
    [switch]$SkipBuild,
    [switch]$Serve,
    [int]$Port = 8801,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ($Help) {
    Write-Output 'metro-local-player.ps1 [-ProjectPath path] [-OutputDirectory path] [-Configuration Release]'
    Write-Output '                       [-SkipBuild] [-Serve] [-Port 8801] [-Help]'
    Write-Output ''
    Write-Output 'Local-only WebGL passenger profile (H3): builds StationGameLocalWeb.unity with the'
    Write-Output 'cohort catalogue, packs it, and optionally serves it on 127.0.0.1 only.'
    exit 0
}
if (!$ProjectPath) { $ProjectPath = Join-Path $repo '.preview/unity/dev-workspace/project' }
$project = (Resolve-Path -LiteralPath $ProjectPath).Path
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo '.preview/unity/local-web' }
$out = [IO.Path]::GetFullPath($OutputDirectory)
$allowed = [IO.Path]::GetFullPath((Join-Path $repo '.preview/unity')) + [IO.Path]::DirectorySeparatorChar
if (!$out.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must be beneath .preview/unity (the local profile is scratch output).'
}
$scene = 'Assets/StationDesigner/Scenes/StationGameLocalWeb.unity'
$cohort = Join-Path $project 'Assets/StationDesigner/Generated/Passengers/passenger-catalogue-web.asset'
if (!(Test-Path (Join-Path $project $scene))) {
    throw "The local Web scene is missing in $project ($scene). Run `-executeMethod Metro.Editor.StationLocalProfile.GenerateWeb` in that project first."
}
if (!(Test-Path $cohort)) {
    throw "The local Web cohort catalogue is missing in $project. Run `-executeMethod Metro.Editor.PassengerCatalogueBuilder.BuildWebCohortMenu` first."
}
if (Test-Path (Join-Path $project 'Temp/UnityLockfile')) {
    throw "The project is open in an Editor ($project). Close it or use a different -ProjectPath."
}
New-Item -ItemType Directory -Force -Path $out | Out-Null

if (!$SkipBuild) {
    $buildDir = Join-Path $out "web-$Configuration"
    if (Test-Path $buildDir) { throw "Build output already exists: $buildDir. Choose a fresh -OutputDirectory or delete it." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'metro-unity.ps1') `
        build-web -ScenePath $scene -Configuration $Configuration -ProjectPath $project -OutputDirectory $out
    if ($LASTEXITCODE -ne 0) { throw "build-web failed with exit code $LASTEXITCODE." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'metro-unity.ps1') `
        pack-web -Configuration $Configuration -ProjectPath $project -OutputDirectory $out
    if ($LASTEXITCODE -ne 0) { throw "pack-web failed with exit code $LASTEXITCODE." }
}
$packed = Join-Path $out 'packed'
if (!(Test-Path (Join-Path $packed 'index.html'))) { throw "No packed player at $packed; run without -SkipBuild." }
Write-Output "LOCAL_WEB_PROFILE pack=$packed profile=soft-human scene=$scene"
Write-Output "Serve locally: node tools/unity-web/static-pack-server.mjs --pack `"$packed`" --port $Port"
Write-Output 'Loopback only. Never upload or publish this pack: INTERNAL_REVIEW_ONLY.'
if ($Serve) {
    & node (Join-Path $repo 'tools/unity-web/static-pack-server.mjs') --pack $packed --port $Port
}
