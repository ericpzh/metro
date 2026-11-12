# Copy the verified passenger library from the scratch proof project into unity/.
#
#   ./tools/unity-assets/promote-passenger-library.ps1 -Project .preview/unity/scratch
#
# The importer (ImportPassengerLibrary.cs) writes 440 GLBs, 440 wrapper prefabs,
# the family manifest and the coverage table under
# Assets/StationDesigner/Generated/Passengers/ in the scratch project. This script
# copies that tree with every paired .meta, so the imported model GUIDs, the
# prefab references and the folder GUIDs survive the move. It only ever writes
# under unity/Assets/StationDesigner/Generated/Passengers/ and refuses to
# overwrite an existing asset whose bytes or GUID differ.
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Destination,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$projectRoot = (Resolve-Path -LiteralPath $Project).Path
$source = Join-Path $projectRoot 'Assets/StationDesigner/Generated/Passengers'
if (!(Test-Path -LiteralPath $source)) { throw "No passenger library at $source" }
if (!$Destination) { $Destination = Join-Path $repo 'unity/Assets/StationDesigner/Generated/Passengers' }
$target = [System.IO.Path]::GetFullPath($Destination)
$allowed = [System.IO.Path]::GetFullPath((Join-Path $repo 'unity/Assets/StationDesigner/Generated/Passengers'))
if ($target -ne $allowed) { throw "Refusing to write outside $allowed (got $target)" }

# Windows PowerShell 5.1 has no Path.GetRelativePath.
function Get-RelativePath([string]$root, [string]$path) {
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
    $pathFull = [System.IO.Path]::GetFullPath($path)
    if (!$pathFull.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Path $pathFull is outside $rootFull"
    }
    return $pathFull.Substring($rootFull.Length + 1)
}

$files = @(Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.Name -notlike '*.meta' })
if ($files.Count -eq 0) { throw "No assets under $source" }

$copied = @()
foreach ($file in $files) {
    $relative = Get-RelativePath $source $file.FullName
    $destination = Join-Path $target $relative
    $meta = $file.FullName + '.meta'
    if (!(Test-Path -LiteralPath $meta)) { throw "Missing paired metadata for $relative" }

    if ((Test-Path -LiteralPath $destination) -and !$Force) {
        $same = (Get-FileHash -LiteralPath $destination).Hash -eq (Get-FileHash -LiteralPath $file.FullName).Hash
        if (!$same) { throw "Refusing to overwrite $destination. Rebuild the destination import instead." }
        $destinationMeta = $destination + '.meta'
        if (!(Test-Path -LiteralPath $destinationMeta)) { throw "Missing destination metadata for $relative" }
        $sourceGuid = (Select-String -LiteralPath $meta -Pattern '^guid: (.+)$').Matches[0].Groups[1].Value
        $destinationGuid = (Select-String -LiteralPath $destinationMeta -Pattern '^guid: (.+)$').Matches[0].Groups[1].Value
        if ($sourceGuid -ne $destinationGuid) { throw "GUID conflict for ${relative}: keep the destination asset" }
    }

    New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    Copy-Item -LiteralPath $meta -Destination ($destination + '.meta') -Force
    $copied += $relative
}

# Folder metadata travels too, or Unity would mint new folder GUIDs on import.
$folders = @(Get-ChildItem -LiteralPath $source -Recurse -Directory)
foreach ($folder in $folders) {
    $relative = Get-RelativePath $source $folder.FullName
    $folderMeta = $folder.FullName + '.meta'
    if (!(Test-Path -LiteralPath $folderMeta)) { continue }
    $destinationFolder = Join-Path $target $relative
    New-Item -ItemType Directory -Force $destinationFolder | Out-Null
    Copy-Item -LiteralPath $folderMeta -Destination ($destinationFolder + '.meta') -Force
}

$byExtension = $copied | Group-Object { [System.IO.Path]::GetExtension($_) } |
    Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ("PROMOTED passenger-library {0} assets ({1}) {2:N1} MB -> {3}" -f `
    $copied.Count, ($byExtension -join ' '), ($bytes / 1MB), $target)
Write-Host 'PASSENGER_LIBRARY_RIGHTS INTERNAL_REVIEW_ONLY production-rig=BLOCKED'
Write-Host 'Open unity/ (or let its Editor refresh) and re-run tools/unity-assets/check-passenger-library.mjs.'
