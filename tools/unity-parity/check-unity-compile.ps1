# Compile-check the StationDesigner C# assemblies without launching Unity.
#
# Unity's generated csproj files are the reference list (engine assemblies, the
# netstandard shims, Newtonsoft, nunit); this script copies them into
# `unity/Temp/acheck/`, swaps the generated file lists for globs over the source
# folders and runs `dotnet build`. It never writes into `Assets/` and never runs
# the editor, so it is safe to run while a lead owns the serial Unity loop.
#
# Three checks, matching the asmdef boundaries:
#   Core   â€” Metro.Sim + Metro.Build + Metro.Persistence (noEngineReferences)
#   Unity  â€” Metro.View + Metro.App + Metro.Runtime
#   Editor â€” Assets/StationDesigner/Editor into the default editor assembly
#   Tests  â€” Assets/StationDesigner/Tests/EditMode
#
# The Core check is what catches an accidental engine reference from the
# engine-free assemblies. `-Skip` names a check to skip (e.g. while another
# packet's in-flight file is broken).
param(
    [string[]] $Skip = @(),
    [string[]] $ExcludeFiles = @()
)
$ErrorActionPreference = 'Stop'
# `-File script.ps1 -ExcludeFiles a,b` arrives as one comma-joined string; accept
# both that and a semicolon list so the switch works from a shell and from -File.
$ExcludeFiles = @($ExcludeFiles | ForEach-Object { $_ -split '[,;]' } | Where-Object { $_ })
$Skip = @($Skip | ForEach-Object { $_ -split '[,;]' } | Where-Object { $_ })
$unity = (Resolve-Path (Join-Path $PSScriptRoot '..\..\unity')).Path
$out = Join-Path $unity 'Temp\acheck'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-CheckProject {
    param([string] $Name, [string] $Template, [string[]] $CompileRoots, [string[]] $ProjectRefs = @())
    $text = Get-Content -Raw (Join-Path $unity $Template)
    # Drop the generated file list and the Unity project references; the check
    # projects include the same sources in one assembly instead.
    $text = [regex]::Replace($text, '(?m)^\s*<Compile Include="[^"]+" />\r?\n', '')
    $text = [regex]::Replace($text, '(?m)^\s*<ProjectReference Include="[^"]+" />\r?\n', '')
    # The collab-proxy package ships a repackaged Newtonsoft.Json with the same
    # assembly identity as the real package. Two copies of one identity make a
    # JArray created in the checker a different type from the one the assembly
    # sees, so the check project must drop the duplicate.
    $text = [regex]::Replace($text, '(?s)\s*<Reference Include="Unity\.Plastic\.Newtonsoft\.Json">.*?</Reference>', '')
    $text = $text -replace '<AssemblyName>[^<]*</AssemblyName>', "<AssemblyName>$Name</AssemblyName>"
    # HintPaths are relative to `unity/`; the check project lives two folders down.
    $text = $text -replace '<HintPath>Library\\', '<HintPath>..\..\Library\'
    $items = New-Object System.Collections.Generic.List[string]
    $items.Add('  <ItemGroup>')
    $exclude = ''
    if ($ExcludeFiles.Count -gt 0) {
        $paths = $ExcludeFiles | ForEach-Object { Join-Path $unity $_ }
        $exclude = ' Exclude="' + ($paths -join ';') + '"'
    }
    foreach ($root in $CompileRoots) {
        $items.Add('    <Compile Include="' + (Join-Path $unity $root) + '\**\*.cs"' + $exclude + ' />')
    }
    foreach ($ref in $ProjectRefs) {
        $items.Add('    <ProjectReference Include="' + (Join-Path $out ($ref + '.csproj')) + '" />')
    }
    $items.Add('  </ItemGroup>')
    $cut = $text.LastIndexOf('</Project>')
    $text = $text.Substring(0, $cut) + ($items -join "`r`n") + "`r`n</Project>" + $text.Substring($cut + '</Project>'.Length)
    [IO.File]::WriteAllText((Join-Path $out ($Name + '.csproj')), $text)
}

$checks = [ordered]@{}
if ($Skip -notcontains 'Core') {
    New-CheckProject -Name 'CheckCore' -Template 'Metro.Persistence.csproj' -CompileRoots @(
        'Assets\StationDesigner\Runtime\Sim',
        'Assets\StationDesigner\Runtime\Build',
        'Assets\StationDesigner\Runtime\Persistence'
    )
    $checks['CheckCore'] = $true
}
if ($Skip -notcontains 'Unity') {
    New-CheckProject -Name 'CheckUnity' -Template 'Metro.App.csproj' -CompileRoots @(
        'Assets\StationDesigner\Runtime\View',
        'Assets\StationDesigner\Runtime\App',
        'Assets\StationDesigner\Scripts'
    ) -ProjectRefs @('CheckCore')
    $checks['CheckUnity'] = $true
}
if ($Skip -notcontains 'Editor') {
    New-CheckProject -Name 'CheckEditor' -Template 'Assembly-CSharp-Editor.csproj' -CompileRoots @(
        'Assets\StationDesigner\Editor'
    ) -ProjectRefs @('CheckCore', 'CheckUnity')
    $checks['CheckEditor'] = $true
}
if ($Skip -notcontains 'Tests') {
    New-CheckProject -Name 'CheckTests' -Template 'Metro.EditModeTests.csproj' -CompileRoots @(
        'Assets\StationDesigner\Tests\EditMode'
    ) -ProjectRefs @('CheckCore', 'CheckUnity')
    # The test assembly names Newtonsoft types through the persistence API (JArray/JObject
    # in StationSaveV1 and ModuleFactsReader signatures). Unity regenerates that reference
    # from the asmdef; this check project is built from the generated template, so inherit
    # the reference from the assembly that already carries it.
    $persistenceProject = Get-Content -Raw (Join-Path $unity 'Metro.Persistence.csproj')
    $newtonsoft = [regex]::Match($persistenceProject, '(?s)<Reference Include="Newtonsoft\.Json">.*?</Reference>')
    if ($newtonsoft.Success) {
        $testsProject = Join-Path $out 'CheckTests.csproj'
        $testsText = Get-Content -Raw $testsProject
        if ($testsText -notmatch '<Reference Include="Newtonsoft\.Json"') {
            $injected = "<ItemGroup>`r`n" + ($newtonsoft.Value -replace '<HintPath>Library\\', '<HintPath>..\..\Library\') + "`r`n  </ItemGroup>"
            [IO.File]::WriteAllText($testsProject, ($testsText -replace '</Project>', ($injected + "`r`n</Project>")))
        }
    }
    $checks['CheckTests'] = $true
}

$failed = @()
foreach ($name in $checks.Keys) {
    Write-Host "== $name"
    & dotnet build (Join-Path $out ($name + '.csproj')) -v q --nologo 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { $failed += $name }
}
if ($failed.Count -gt 0) {
    Write-Host ("compile-check FAILED: " + ($failed -join ', '))
    exit 1
}
Write-Host ("compile-check OK: " + ($checks.Keys -join ', '))
