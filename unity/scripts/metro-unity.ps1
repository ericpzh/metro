[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('doctor','bootstrap','test','build-web','import-assets','pack-web','smoke-web')][string]$Task = 'doctor',
    [ValidateSet('EditMode','PlayMode')][string]$Mode = 'EditMode',
    [ValidateSet('Development','Release')][string]$Configuration = 'Development',
    [ValidateSet('Bootstrap','FirstPlayable','ZooPlayable','StationGame')][string]$Scene = 'Bootstrap',
    [string]$ScenePath = '',
    [string]$ProjectPath,
    [string]$OutputDirectory,
    [string]$Manifest,
    [string]$TestFilter = '',
    [int]$TimeoutSeconds = 1800,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'metro-unity.ps1 TASK [-ProjectPath path] [-OutputDirectory path] [-Manifest path] [-TimeoutSeconds n] [-Mode EditMode|PlayMode] [-Configuration Development|Release] [-Scene Bootstrap|FirstPlayable|ZooPlayable] [-Help]'
    Write-Output 'Tasks: doctor, bootstrap, test, build-web, pack-web, smoke-web, import-assets.'
    Write-Output 'METRO_UNITY_EDITOR overrides the pinned Editor path; METRO_WRANGLER overrides the Wrangler JS entry for smoke-web.'
    exit 0
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (!$ProjectPath) { $ProjectPath = Join-Path $repo 'unity' }
$project = (Resolve-Path -LiteralPath $ProjectPath).Path
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repo '.preview/unity/phase-0' }
$base = [IO.Path]::GetFullPath((Join-Path $repo '.preview/unity')) + [IO.Path]::DirectorySeparatorChar
$out = [IO.Path]::GetFullPath($OutputDirectory)
if (!$out.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must be beneath .preview/unity.' }
if ($TimeoutSeconds -lt 1) { throw 'TimeoutSeconds must be positive.' }
$versionLine = Get-Content (Join-Path $project 'ProjectSettings/ProjectVersion.txt') | Where-Object { $_ -match '^m_EditorVersion: ' } | Select-Object -First 1
$version = $versionLine -replace '^m_EditorVersion: ',''
$revisionLine = Get-Content (Join-Path $project 'ProjectSettings/ProjectVersion.txt') | Where-Object { $_ -match '^m_EditorVersionWithRevision: ' } | Select-Object -First 1
$versionRevision = $revisionLine -replace '^m_EditorVersionWithRevision: ',''
$editor = if ($env:METRO_UNITY_EDITOR) { $env:METRO_UNITY_EDITOR } else { "C:/Program Files/Unity/Hub/Editor/$version/Editor/Unity.exe" }
$module = Join-Path (Split-Path $editor) 'Data/PlaybackEngines/WebGLSupport'
$editorProductVersion = if (Test-Path -LiteralPath $editor) { (Get-Item -LiteralPath $editor).VersionInfo.ProductVersion } else { $null }
$expectedProductVersion = $versionRevision -replace ' \(', '_' -replace '\)', ''
$nodeVersion = (& node --version).TrimStart('v')
$nodePin = (Get-Content (Join-Path $PSScriptRoot 'node-version.txt') -Raw).Trim()
if ($Task -eq 'doctor') {
    $locked = (Get-Content (Join-Path $project 'Packages/packages-lock.json') -Raw | ConvertFrom-Json).dependencies
    [pscustomobject]@{ Repo=$repo; Project=$project; EditorVersion=$version; EditorVersionWithRevision=$versionRevision; Editor=$editor; EditorExists=(Test-Path -LiteralPath $editor); EditorProductVersion=$editorProductVersion; EditorMatchesPin=($editorProductVersion -eq $expectedProductVersion); WebGLModule=(Test-Path -LiteralPath $module); Node=$nodeVersion; NodePin=$nodePin; NodeMatchesPin=($nodeVersion -eq $nodePin); Output=$out; ProjectLock=(Test-Path (Join-Path $project 'Temp/UnityLockfile')); Packages=(Get-Content (Join-Path $project 'Packages/manifest.json') -Raw | ConvertFrom-Json).dependencies; ResolvedPackages=$locked } | ConvertTo-Json -Depth 8
    exit 0
}
if ($nodeVersion -ne $nodePin) { throw "Node version $nodeVersion does not match the pin $nodePin." }
if ($Task -in @('pack-web','smoke-web')) {
    if ($Task -eq 'pack-web') { & node (Join-Path $repo 'tools/unity-web/pack.mjs') (Join-Path $out "web-$Configuration") (Join-Path $out 'packed') }
    else { & node (Join-Path $repo 'tools/unity-web/smoke.mjs') $out }
    if ($LASTEXITCODE -ne 0) { throw "$Task failed with exit code $LASTEXITCODE." }
    exit 0
}
if (!(Test-Path -LiteralPath $editor) -or !(Test-Path -LiteralPath $module)) { throw 'Pinned Editor or WebGL module not found.' }
if (!$versionRevision -or $editorProductVersion -ne $expectedProductVersion) { throw "Editor version does not match the project pin: $editorProductVersion versus $versionRevision" }
if (Test-Path (Join-Path $project 'Temp/UnityLockfile')) { throw 'Project is locked by a running Editor. Use a separate copy.' }
# The runtime catalogue generator reads the checked-in recipe folder. A scratch copy of
# Assets, Packages and ProjectSettings does not carry it, so stage it beside the project.
$recipes = Join-Path $project 'asset-recipes'
if (!(Test-Path -LiteralPath $recipes) -and (Test-Path -LiteralPath (Join-Path $repo 'unity/asset-recipes'))) {
    Copy-Item -LiteralPath (Join-Path $repo 'unity/asset-recipes') -Destination $recipes -Recurse
}
New-Item -ItemType Directory -Force -Path $out | Out-Null
$headAtStart = (& git -C $repo rev-parse HEAD).Trim()
$log = Join-Path $out "$Task-$Mode-$Configuration.log"
$argsList = @('-batchmode','-nographics','-projectPath',('"'+$project+'"'),'-logFile',('"'+$log+'"'))
switch ($Task) {
    'bootstrap' { $method = if ($Scene -eq 'FirstPlayable') { 'Metro.Editor.FirstPlayable.Generate' } elseif ($Scene -eq 'ZooPlayable') { 'Metro.Editor.ZooPlayable.Generate' } elseif ($Scene -eq 'StationGame') { 'Metro.Editor.StationGameScene.Generate' } else { 'Metro.Editor.Bootstrap.Generate' }; $argsList += @('-quit','-executeMethod',$method) }
    'import-assets' {
        if (!$Manifest) { throw 'import-assets requires -Manifest.' }
        $manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
        $importReport = Join-Path $out 'import-report.json'
        if (Test-Path -LiteralPath $importReport) { Remove-Item -LiteralPath $importReport }
        $argsList += @('-quit','-executeMethod','Metro.Editor.ImportAssets.Run','-metroManifest',('"'+$manifestPath+'"'),'-metroImportReport',('"'+$importReport+'"'))
    }
    'test' {
        $xml = Join-Path $out "$Mode.xml"; if(Test-Path $xml){ Remove-Item -LiteralPath $xml }
        $argsList += @('-runTests','-testPlatform',$Mode,'-testResults',('"'+$xml+'"'))
        if ($TestFilter) { $argsList += @('-testFilter',('"'+$TestFilter+'"')) }
    }
    'build-web' { $build = Join-Path $out "web-$Configuration"; if(Test-Path $build){ throw 'Build output already exists; choose a fresh output directory.' }; $sceneArg = if ($ScenePath) { $ScenePath } else { $Scene }; $argsList += @('-quit','-buildTarget','WebGL','-executeMethod','Metro.Editor.BuildWeb.Run','-metroOut',('"'+$build+'"'),'-metroConfiguration',$Configuration,'-metroScene',$sceneArg) }
}
function Get-RelativePath([string]$basePath, [string]$targetPath) {
    # Windows PowerShell 5.1 has no [IO.Path]::GetRelativePath; derive it from URIs.
    $baseUri = [Uri](($basePath.TrimEnd([IO.Path]::DirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar)
    $targetUri = [Uri]([IO.Path]::GetFullPath($targetPath))
    [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', '\')
}
# The build rewrites the URP global settings (shader stripping and variant
# collections), so that one asset is a build output rather than a source input.
$script:BuildMutableInputs = @('Assets/Settings/UniversalRenderPipelineGlobalSettings.asset')
function Get-InputSnapshot($root, $directories) {
    @($directories | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $root $_) -Recurse -File } | Sort-Object FullName | ForEach-Object {
        $relative = (Get-RelativePath $root $_.FullName).Replace('\','/')
        if ($script:BuildMutableInputs -contains $relative) { return }
        [pscustomobject]@{ Path=$relative; SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
}
if ($Task -eq 'build-web') {
    $inputsAtStart = @(Get-InputSnapshot $project @('Assets','Packages','ProjectSettings'))
    $fixturesAtStart = @(Get-InputSnapshot $repo @('unity/tests/fixtures'))
    [pscustomobject]@{ Head=$headAtStart; Inputs=$inputsAtStart; Fixtures=$fixturesAtStart } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 ($build+'.inputs-before.json')
}
$p = Start-Process -FilePath $editor -ArgumentList $argsList -WindowStyle Hidden -PassThru
if (!$p.WaitForExit($TimeoutSeconds * 1000)) { $p.Kill(); $p.WaitForExit(); throw "Unity timed out; see $log" }
if ($p.ExitCode -ne 0) { throw "Unity exited $($p.ExitCode); see $log" }
if ($Task -eq 'test') {
    if (!(Test-Path $xml)) { throw 'Unity did not produce test XML.' }
    [xml]$result = Get-Content -LiteralPath $xml -Raw
    if ([int]$result.'test-run'.total -le 0 -or [int]$result.'test-run'.failed -ne 0 -or $result.'test-run'.result -ne 'Passed') { throw "Test results missing, empty or failed: $xml" }
}
if ($Task -eq 'build-web') {
    if (!(Test-Path (Join-Path $build 'index.html')) -or !(Test-Path ($build+'.report.json'))) { throw 'Web build output or report missing.' }
    $report = Get-Content ($build+'.report.json') -Raw | ConvertFrom-Json
    if ($report.result -ne 'Succeeded') { throw 'Build report does not say Succeeded.' }
    $inputs = @(Get-InputSnapshot $project @('Assets','Packages','ProjectSettings'))
    $fixtures = @(Get-InputSnapshot $repo @('unity/tests/fixtures'))
    if ((ConvertTo-Json -InputObject $inputsAtStart -Compress -Depth 6) -cne (ConvertTo-Json -InputObject $inputs -Compress -Depth 6) -or (ConvertTo-Json -InputObject $fixturesAtStart -Compress -Depth 6) -cne (ConvertTo-Json -InputObject $fixtures -Compress -Depth 6)) { throw 'Project inputs or fixtures changed during the build; preserve the output and pre-build snapshot, then rebuild.' }
    $files = Get-ChildItem -LiteralPath $build -Recurse -File | ForEach-Object {
        [pscustomobject]@{ Path=(Get-RelativePath $build $_.FullName).Replace('\','/'); Bytes=$_.Length; SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }
    $head = (& git -C $repo rev-parse HEAD).Trim()
    if ($head -ne $headAtStart) { throw 'Repository HEAD changed during the build; preserve the output but rebuild for traceable provenance.' }
    $dirty = [bool]((& git -C $repo status --porcelain) | Select-Object -First 1)
    [pscustomobject]@{ Head=$head; HeadMeaning='workspace HEAD at build; project inputs are identified by hashes'; Dirty=$dirty; ProjectPath=$project; EditorVersion=$version; EditorVersionWithRevision=$versionRevision; Configuration=$Configuration; Compression='Disabled'; DecompressionFallback=$false; Scene=$(if ($ScenePath) { $ScenePath } else { "Assets/StationDesigner/Scenes/$Scene.unity" }); Inputs=@($inputsAtStart); Fixtures=@($fixturesAtStart); InputsVerifiedAfterBuild=$true; Files=@($files) } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 ($build+'.provenance.json')
}
Write-Output "$Task succeeded; log: $log"
