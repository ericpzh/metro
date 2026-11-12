# Copy one verified family from the scratch proof project into the real Unity project.
#
#   ./tools/unity-assets/promote-family.ps1 -Family cctv -Project D:\metro-unity-scratch\cctv-20261111-120000-000
#
# The review script must have written its GLBs, wrapper prefabs and review scenes
# under Assets/<Family>Proof/. Files are copied with their paired .meta so the
# imported model GUID, prefab references and scene references survive the move.
# The script refuses to overwrite an existing GLB or prefab whose metadata is not
# identical: an update has to regenerate the wrapper against the destination
# import instead of overwriting it.
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]*$')][string]$Family,
    [Parameter(Mandatory = $true)][string]$Project,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$class = (Get-Culture).TextInfo.ToTitleCase($Family)
$source = Join-Path $Project "Assets/${class}Proof"
if (!(Test-Path -LiteralPath $source)) { throw "No proof assets at $source" }
$generated = Join-Path $repo 'unity/Assets/StationDesigner/Generated'
$targets = @{
    '.glb'    = Join-Path $generated 'Models'
    '.prefab' = Join-Path $generated 'Prefabs'
    '.unity'  = Join-Path $generated 'Review'
}

$copied = @()
foreach ($file in Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Extension -in $targets.Keys -and !$_.Name.StartsWith('__') }) {
    $destinationFolder = $targets[$file.Extension]
    New-Item -ItemType Directory -Force $destinationFolder | Out-Null
    $destination = Join-Path $destinationFolder $file.Name
    if ((Test-Path -LiteralPath $destination) -and !$Force) {
        $same = (Get-FileHash -LiteralPath $destination).Hash -eq (Get-FileHash -LiteralPath $file.FullName).Hash
        if (!$same) { throw "Refusing to overwrite $destination. Promote an update through the destination import." }
    }
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    $meta = $file.FullName + '.meta'
    if (!(Test-Path -LiteralPath $meta)) { throw "Missing paired metadata for $($file.Name)" }
    $metaDestination = $destination + '.meta'
    if (Test-Path -LiteralPath $metaDestination) {
        $sourceGuid = (Select-String -LiteralPath $meta -Pattern '^guid: (.+)$').Matches[0].Groups[1].Value
        $destinationGuid = (Select-String -LiteralPath $metaDestination -Pattern '^guid: (.+)$').Matches[0].Groups[1].Value
        if ($sourceGuid -ne $destinationGuid) { throw "GUID conflict for $($file.Name): keep the destination asset and regenerate its wrapper" }
    }
    Copy-Item -LiteralPath $meta -Destination $metaDestination -Force
    $copied += [pscustomobject]@{ file = $file.Name; destination = $destination; guid = (Select-String -LiteralPath $meta -Pattern '^guid: (.+)$').Matches[0].Groups[1].Value }
}
if ($copied.Count -eq 0) { throw "No promotable files under $source" }
$copied | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host "PROMOTED $Family $($copied.Count) files"
Write-Host 'Open unity/ (or let its Editor refresh) and confirm the assets resolve before claiming the rows.'
