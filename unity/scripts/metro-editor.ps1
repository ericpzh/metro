# metro-editor.ps1 - drive the open Station Designer Unity Editor through the Unity CLI.
#
# This is the live-editor sibling of metro-unity.ps1. It never opens a second Unity
# process: it talks to the Editor already running on unity/ through the Pipeline
# package, so C# recompiles, targeted tests and the StationGame smoke run reuse the
# same domain instead of rebuilding a WebGL player.
#
# Examples (from the repository root):
#   ./unity/scripts/metro-editor.ps1 status
#   ./unity/scripts/metro-editor.ps1 compile
#   ./unity/scripts/metro-editor.ps1 test -Mode EditMode -TestFilter StationClockTests
#   ./unity/scripts/metro-editor.ps1 test -Mode PlayMode -TestFilter BootstrapPlayTests
#   ./unity/scripts/metro-editor.ps1 smoke -Demo zoo
#
# Every operation serializes on a named mutex, writes its evidence under
# .preview/unity/editor/<run-id>/, and exits non-zero when a check is incomplete.
# The smoke leaves Play Mode running (use -StopAfter to exit it) so a second run
# reuses the same session; -NoRepeat skips the second run.
[CmdletBinding()]
param(
    [Parameter(Position=0)][ValidateSet('status','compile','test','smoke','verify')][string]$Operation = 'status',
    [string]$ProjectPath,
    [string]$OutputDirectory,
    [ValidateSet('EditMode','PlayMode')][string]$Mode = 'EditMode',
    [string]$TestFilter = '',
    [string]$Demo = 'zoo',
    [ValidateSet('StationGameLocal')][string]$Scene = 'StationGameLocal',
    [int]$Ticks = 30,
    [int]$TimeoutSeconds = 300,
    [int]$LockTimeoutSeconds = 900,
    [switch]$StopAfter,
    [switch]$NoRepeat,
    [switch]$Force,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
if ($Help) {
    Write-Output 'metro-editor.ps1 OPERATION [-ProjectPath path] [-OutputDirectory path] [-Mode EditMode|PlayMode]'
    Write-Output '                [-TestFilter name] [-Demo zoo|tanwei|tianhe] [-Scene StationGameLocal]'
    Write-Output '                [-Ticks n] [-TimeoutSeconds n]'
    Write-Output '                [-LockTimeoutSeconds n] [-StopAfter] [-NoRepeat] [-Force] [-Help]'
    Write-Output ''
    Write-Output 'Operations:'
    Write-Output '  status   Project path, Editor version, readiness, Pipeline version and Play Mode state.'
    Write-Output '  compile  Incremental refresh of the open Editor and its compiler diagnostics.'
    Write-Output '  test     A targeted EditMode or PlayMode run on the open Editor; results and counts are saved.'
    Write-Output '  smoke    Load the Zoo demo through StationGameHost, step fixed ticks, capture the Game view.'
    Write-Output '           -Scene StationGameLocal (the single scene) binds the internal crowd in interactive Play Mode.'
    Write-Output '  verify   compile + filtered test + smoke in one serialized operation.'
    Write-Output ''
    Write-Output 'Artifacts: .preview/unity/editor/<run-id>/ (override with -OutputDirectory).'
    exit 0
}

# ---------------------------------------------------------------- environment

$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (!$ProjectPath) { $ProjectPath = Join-Path $repo 'unity' }
$project = (Resolve-Path -LiteralPath $ProjectPath).Path
$versionLine = Get-Content (Join-Path $project 'ProjectSettings/ProjectVersion.txt') |
    Where-Object { $_ -match '^m_EditorVersion: ' } | Select-Object -First 1
if (!$versionLine) { throw "ProjectVersion.txt has no m_EditorVersion: $project" }
$editorVersion = ($versionLine -replace '^m_EditorVersion: ', '').Trim()
$revisionLine = Get-Content (Join-Path $project 'ProjectSettings/ProjectVersion.txt') |
    Where-Object { $_ -match '^m_EditorVersionWithRevision: ' } | Select-Object -First 1
$editorVersionRevision = if ($revisionLine) { ($revisionLine -replace '^m_EditorVersionWithRevision: ', '').Trim() } else { $editorVersion }

$unityCommand = Get-Command unity -ErrorAction SilentlyContinue
if (!$unityCommand) {
    throw 'The Unity CLI (`unity`) is not on PATH. Install it with: irm https://unity.com/install.ps1 | iex'
}
$script:Unity = $unityCommand.Path
if (!$script:Unity) { $script:Unity = $unityCommand.Source }

$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Operation + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
if ($OutputDirectory) {
    $out = [IO.Path]::GetFullPath($OutputDirectory)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.preview/unity')) + [IO.Path]::DirectorySeparatorChar
    if (!$out.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw "OutputDirectory must be beneath .preview/unity: $out"
    }
    if ((Test-Path -LiteralPath $out) -and !$Force -and (Get-ChildItem -LiteralPath $out -Force | Select-Object -First 1)) {
        throw "OutputDirectory already exists and is not empty; pass -Force to reuse it: $out"
    }
} else {
    $out = Join-Path $repo ".preview/unity/editor/$runId"
}
$logDir = Join-Path $out 'logs'
New-Item -ItemType Directory -Force -Path $out, $logDir | Out-Null
$runPath = Join-Path $out 'run.json'
$script:RunId = $runId
$script:Output = $out
$script:LogDir = $logDir
$script:Repo = $repo
$script:Project = $project
$script:EditorVersion = $editorVersion
$script:EditorVersionRevision = $editorVersionRevision
$script:FailedStage = $null
$script:CurrentStage = $null
$script:Stages = [ordered]@{}
$script:Checks = @()
$script:CliCalls = @()

# One operation at a time on this Editor. Named mutexes are session-local, which
# matches one desktop user driving one Editor.
$mutex = New-Object System.Threading.Mutex -ArgumentList @($false, 'Local\MetroUnityEditorWorkflow')
$acquired = $false
try {
    $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds($LockTimeoutSeconds))
} catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
}
if (!$acquired) {
    $mutex.Dispose()
    throw "Another metro-editor operation still holds the Editor lock after $LockTimeoutSeconds seconds."
}

$script:Head = (& git -C $repo rev-parse HEAD 2>$null).Trim()
$script:StatusBefore = @(& git -C $repo status --porcelain 2>$null)
$script:UnityStatusBefore = @(& git -C $repo status --porcelain -- unity/Assets unity/Packages unity/ProjectSettings unity/scripts 2>$null)
$script:StartedAt = Get-Date

function Write-RunFile {
    $script:Run.status = if ($script:FailedStage -or $script:Run.status -eq 'failed') { 'failed' } else { $script:Run.status }
    $script:Run.finishedAt = (Get-Date).ToString('o')
    $script:Run.durationMs = [math]::Round(((Get-Date) - $script:StartedAt).TotalMilliseconds, 1)
    $script:Run.stages = $script:Stages
    $script:Run.checks = $script:Checks
    $script:Run.cliCalls = $script:CliCalls
    $script:Run | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $runPath -Encoding utf8
}

function Add-Check([string]$name, [bool]$ok, [string]$detail = '') {
    $script:Checks += [pscustomobject]@{ name = $name; ok = $ok; detail = $detail }
    return $ok
}

function Require-Check([string]$name, [bool]$ok, [string]$detail = '') {
    if (!(Add-Check $name $ok $detail)) {
        $script:FailedStage = 'checks'
        throw "$name failed: $detail"
    }
}

function Invoke-Stage([string]$name, [scriptblock]$body) {
    $script:CurrentStage = $name
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        return (& $body)
    } catch {
        $script:FailedStage = $name
        throw
    } finally {
        $stopwatch.Stop()
        $script:Stages[$name] = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
    }
}

function Format-CliError($result) {
    $message = ''
    if ($result.Stderr) { $message = $result.Stderr.Trim() }
    if (!$message -and $result.Stdout) { $message = $result.Stdout.Trim() }
    if ($result.Json -and $result.Json.errors -and $result.Json.errors.Count) {
        $message = ($result.Json.errors | ForEach-Object { "$($_.code): $($_.message)" }) -join '; '
    }
    if (!$message) { $message = "exit $($result.ExitCode)" }
    return $message
}

# Invoke the Unity CLI and keep stdout/stderr under logs/. A command result is the
# pipeline's own JSON (single object) unless -Lines is used for test records.
function Invoke-Unity {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$Label = 'unity',
        [switch]$AllowFailure,
        [switch]$Lines
    )
    $safe = ($Label -replace '[^A-Za-z0-9_.-]', '_')
    $stdoutPath = Join-Path $script:LogDir "$safe.stdout.log"
    $stderrPath = Join-Path $script:LogDir "$safe.stderr.log"
    $allArgs = @('--no-banner', '--no-pager', '--format', 'json') + $Arguments
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $stdout = (& $script:Unity @allArgs 2> $stderrPath | Out-String)
    $exitCode = $LASTEXITCODE
    $stopwatch.Stop()
    Set-Content -LiteralPath $stdoutPath -Value $stdout -Encoding utf8
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
    $json = $null
    $records = @()
    $trimmed = $stdout.Trim()
    if ($Lines) {
        if ($trimmed.StartsWith('[')) {
            try { $records = @($trimmed | ConvertFrom-Json) } catch { $records = @() }
        } else {
            foreach ($line in ($stdout -split "`r?`n")) {
                if (!$line.Trim()) { continue }
                try { $records += ($line | ConvertFrom-Json) } catch { }
            }
        }
        if ($records.Count -eq 1 -and $records[0] -is [Array]) { $records = @($records[0]) }
    } elseif ($trimmed) {
        try { $json = $trimmed | ConvertFrom-Json } catch { $json = $null }
    }
    $result = [pscustomobject]@{
        ExitCode   = $exitCode
        Stdout     = $stdout
        Stderr     = $stderr
        Json       = $json
        Records    = $records
        DurationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
        Label      = $Label
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
    }
    $script:CliCalls += [pscustomobject]@{
        label = $Label
        exitCode = $exitCode
        durationMs = $result.DurationMs
        stdout = (Split-Path -Leaf $stdoutPath)
        stderr = (Split-Path -Leaf $stderrPath)
    }
    if (!$AllowFailure -and $exitCode -ne 0) {
        throw "Unity CLI '$Label' failed (exit $exitCode): $(Format-CliError $result)"
    }
    if (!$AllowFailure -and $json -and $json.success -eq $false) {
        throw "Unity CLI '$Label' failed: $(Format-CliError $result)"
    }
    return $result
}

function Invoke-EditorCommand {
    param(
        [Parameter(Mandatory)][string[]]$Command,
        [string]$Label,
        [int]$RequestTimeout = 60,
        [switch]$AllowFailure,
        [switch]$Lines
    )
    if (!$Label) { $Label = ($Command -join '-') }
    $args = @('command', '--project-path', $script:Project, '--timeout', "$RequestTimeout") + $Command
    return Invoke-Unity -Arguments $args -Label $Label -AllowFailure:$AllowFailure -Lines:$Lines
}

function Invoke-Status {
    param([int]$Timeout = 60, [switch]$UntilReady, [switch]$AllowFailure)
    $args = @('status', '--project-path', $script:Project)
    if ($UntilReady) { $args += @('--until-ready', '--timeout', "$Timeout") }
    return Invoke-Unity -Arguments $args -Label 'status' -AllowFailure:$AllowFailure
}

function Wait-EditorReady {
    param([int]$Timeout = 120)
    $deadline = (Get-Date).AddSeconds($Timeout)
    $last = $null
    while ((Get-Date) -lt $deadline) {
        $remaining = [int][math]::Max(1, ($deadline - (Get-Date)).TotalSeconds)
        $result = Invoke-Status -Timeout $remaining -UntilReady -AllowFailure
        $last = $result
        if ($result.ExitCode -eq 0 -and $result.Json -and $result.Json.success -ne $false -and
            $result.Json.data -and $result.Json.data.instances -and @($result.Json.data.instances).Count -gt 0) {
            $instance = @($result.Json.data.instances)[0]
            if ($instance.projectPath -and $instance.version) {
                $actualPath = [IO.Path]::GetFullPath([string]$instance.projectPath)
                if ([string]::Equals($actualPath, $script:Project, [StringComparison]::OrdinalIgnoreCase) -and
                    $instance.version -eq $script:EditorVersion -and $instance.state -eq 'ready') {
                    $script:Run.editor = [ordered]@{
                        version = $instance.version
                        pid = $instance.pid
                        port = $instance.port
                        state = $instance.state
                        projectPath = $actualPath
                    }
                    return $instance
                }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    $detail = if ($last) { Format-CliError $last } else { 'no status result' }
    throw "Unity Editor never became Pipeline-ready within $Timeout seconds: $detail"
}

function Get-EditorState {
    param([int]$RequestTimeout = 60)
    $result = Invoke-EditorCommand -Command @('editor', 'status') -Label 'editor-status' -RequestTimeout $RequestTimeout
    return $result.Json
}

function Wait-PlayMode {
    param([string]$Wanted = 'playing', [int]$Timeout = 120)
    $deadline = (Get-Date).AddSeconds($Timeout)
    while ((Get-Date) -lt $deadline) {
        try {
            $state = Get-EditorState -RequestTimeout 30
            if ($state.playMode -eq $Wanted) { return $state }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Editor never reached playMode '$Wanted' within $Timeout seconds."
}

function Get-ConsoleState {
    $result = Invoke-EditorCommand -Command @('console', 'status') -Label 'console-status'
    return $result.Json
}

function Get-ConsoleErrorsSince {
    param([Nullable[long]]$Cursor, [string]$Session, [datetime]$Since, [int]$Tail = 200)
    $entries = @()
    $reset = $false
    $sinceSession = $null
    if ($Cursor.HasValue -and $Session) {
        $r = Invoke-EditorCommand -Command @('console', 'get', '--level', 'error', '--tail', "$Tail",
            '--since', "$($Cursor.Value)", '--since-session', $Session) -Label 'console-delta' -AllowFailure
        if ($r.ExitCode -eq 0 -and $r.Json) {
            $entries = @($r.Json.entries)
            $reset = [bool]$r.Json.reset
        } else {
            $sinceSession = $r.Stderr.Trim()
        }
    }
    if ($entries.Count -eq 0 -and ($reset -or !$Cursor.HasValue -or !$Session)) {
        $r = Invoke-EditorCommand -Command @('console', 'get', '--level', 'error', '--tail', "$Tail") -Label 'console-errors' -AllowFailure
        if ($r.ExitCode -eq 0 -and $r.Json) { $entries = @($r.Json.entries) }
    }
    $fresh = @()
    foreach ($entry in $entries) {
        if (!$entry) { continue }
        $stamp = $null
        try { $stamp = [datetime]::Parse($entry.timestampUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) } catch { }
        if ($stamp -and $stamp.ToUniversalTime() -lt $Since.ToUniversalTime()) { continue }
        $fresh += $entry
    }
    return [pscustomobject]@{ entries = $fresh; reset = $reset; cursor = $Cursor; session = $Session }
}

function Get-Fixture {
    param([string]$Id)
    $manifestPath = Join-Path $script:Project 'Assets/StationDesigner/Demos/provenance.json'
    if (!(Test-Path -LiteralPath $manifestPath)) { throw "Demo manifest is missing: $manifestPath" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $demo = @($manifest.demos | Where-Object { $_.id -eq $Id }) | Select-Object -First 1
    if (!$demo) { throw "Unknown demo '$Id'. Known: $(@($manifest.demos | ForEach-Object { $_.id }) -join ', ')" }
    $file = Join-Path (Split-Path -Parent $manifestPath) $demo.file
    if (!(Test-Path -LiteralPath $file)) { throw "Demo fixture is missing: $file" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    return [pscustomobject]@{
        id = $Id
        file = $file
        relativePath = 'Assets/StationDesigner/Demos/' + $demo.file
        bytes = (Get-Item -LiteralPath $file).Length
        sha256 = $hash
        expectedSha256 = [string]$demo.outputSha256
        counts = $demo.counts
    }
}

function Get-SceneState {
    $result = Invoke-EditorCommand -Command @('scene', 'list_open') -Label 'scene-list'
    $scenes = @()
    if ($result.Json -is [Array]) { $scenes = @($result.Json) }
    elseif ($result.Json) { $scenes = @($result.Json) }
    return $scenes
}

function Get-UnityCliVersion {
    $result = Invoke-Unity -Arguments @('version') -Label 'cli-version'
    return $result.Json.data
}

function Get-PipelineVersion {
    $result = Invoke-Unity -Arguments @('pipeline', 'editors') -Label 'pipeline-editors'
    if (!$result.Json -or !$result.Json.data -or !$result.Json.data.instances) { return $null }
    $instance = @($result.Json.data.instances | Where-Object {
        [string]::Equals([IO.Path]::GetFullPath([string]$_.projectPath), $script:Project, [StringComparison]::OrdinalIgnoreCase)
    }) | Select-Object -First 1
    if (!$instance) { return $null }
    return [pscustomobject]@{ version = $instance.pipelineVersion; reachable = $instance.pipelineServer.isReachable }
}

function Get-PngInfo {
    param([string]$Path)
    if (!(Test-Path -LiteralPath $Path)) { return $null }
    $bytes = [IO.File]::ReadAllBytes($Path)
    $signature = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    $isPng = $bytes.Length -ge 8
    if ($isPng) {
        for ($i = 0; $i -lt 8; $i++) { if ($bytes[$i] -ne $signature[$i]) { $isPng = $false; break } }
    }
    return [pscustomobject]@{
        path = $Path
        bytes = $bytes.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        isPng = $isPng
        width = if ($isPng -and $bytes.Length -ge 24) { [int]$bytes[16] * 16777216 + [int]$bytes[17] * 65536 + [int]$bytes[18] * 256 + [int]$bytes[19] } else { 0 }
        height = if ($isPng -and $bytes.Length -ge 24) { [int]$bytes[20] * 16777216 + [int]$bytes[21] * 65536 + [int]$bytes[22] * 256 + [int]$bytes[23] } else { 0 }
    }
}

function Get-StatusSnapshot {
    $status = Invoke-Status -Timeout 30 -AllowFailure
    $pipeline = Get-PipelineVersion
    $editor = $null
    $scenes = @()
    if ($status.ExitCode -eq 0) {
        try { $editor = Get-EditorState -RequestTimeout 30 } catch { }
        try { $scenes = Get-SceneState } catch { }
    }
    return [pscustomobject]@{
        cli = $script:Run.cli
        status = $status
        pipeline = $pipeline
        editor = $editor
        scenes = $scenes
    }
}

# ---------------------------------------------------------------- operations

function Invoke-StatusOperation {
    $snapshot = Invoke-Stage 'status' { Get-StatusSnapshot }
    $script:Run.operation = 'status'
    $script:Run.project = $script:Project
    $script:Run.editorVersion = $script:EditorVersion
    $script:Run.editorVersionRevision = $script:EditorVersionRevision
    $script:Run.pipeline = $snapshot.pipeline
    $script:Run.editor = $snapshot.editor
    $script:Run.scenes = @($snapshot.scenes | ForEach-Object { [ordered]@{ name = $_.name; path = $_.path; isActive = $_.isActive; isDirty = $_.isDirty } })
    $ready = $snapshot.status.ExitCode -eq 0 -and $snapshot.status.Json -and $snapshot.status.Json.success -ne $false
    if ($ready -and $snapshot.status.Json.data.instances) {
        $instance = @($snapshot.status.Json.data.instances)[0]
        $script:Run.ready = $true
        $script:Run.editor = [ordered]@{
            version = $instance.version
            pid = $instance.pid
            port = $instance.port
            state = $instance.state
            projectPath = $instance.projectPath
        }
    } else {
        $script:Run.ready = $false
    }
    Add-Check 'editor-ready' $ready $(if ($ready) { 'Pipeline instance is reachable.' } else { Format-CliError $snapshot.status }) | Out-Null
    $manifest = Get-Content (Join-Path $script:Project 'Packages/manifest.json') -Raw | ConvertFrom-Json
    $expectedPipeline = $manifest.dependencies.'com.unity.pipeline'
    $pipelineOk = !$expectedPipeline -or ($snapshot.pipeline -and $snapshot.pipeline.version -eq $expectedPipeline)
    Add-Check 'pipeline-version' $pipelineOk "manifest=$expectedPipeline running=$(if ($snapshot.pipeline) { $snapshot.pipeline.version } else { 'none' })." | Out-Null
    $script:Run.status = if ($ready -and $pipelineOk) { 'passed' } else { 'failed' }
    if (!$ready -or !$pipelineOk) { $script:FailedStage = 'status' }
    $script:Run.evidence = @{ run = $runPath }
}

function Invoke-CompileOperation {
    $script:Run.operation = 'compile'
    $script:Run.project = $script:Project
    $script:Run.editorVersion = $script:EditorVersion
    $script:Run.editorVersionRevision = $script:EditorVersionRevision
    $script:Run.cli = $script:CliVersion
    $script:Run.request = [ordered]@{ mode = 'incremental' }

    $ready = Invoke-Stage 'compile.ready' { Wait-EditorReady -Timeout 60 }
    $editorState = Invoke-Stage 'compile.editor-state' { Get-EditorState }
    if ($editorState.playMode -eq 'playing') {
        Invoke-Stage 'compile.stop-playmode' {
            Invoke-EditorCommand -Command @('editor.playmode', 'stop') -Label 'playmode-stop-before-compile' -RequestTimeout 60 | Out-Null
            Wait-PlayMode -Wanted 'stopped' -Timeout 60 | Out-Null
        } | Out-Null
    }
    $before = Invoke-Stage 'compile.console-before' { Get-ConsoleState }
    $compileStart = Get-Date
    $recompile = Invoke-Stage 'compile.recompile' {
        Invoke-EditorCommand -Command @('script', 'recompile') -Label 'script-recompile' -RequestTimeout 120 -AllowFailure
    }
    $script:Run.recompile = $recompile.Json
    if ($recompile.ExitCode -ne 0) {
        throw "script recompile failed: $(Format-CliError $recompile)"
    }
    if ($recompile.Json -and $recompile.Json.status -eq 'failed') {
        throw 'script recompile reported failed; read console errors.'
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastStatus = $null
    $status = $null
    while ((Get-Date) -lt $deadline) {
        $poll = Invoke-EditorCommand -Command @('script', 'recompile_status') -Label 'recompile-status' -RequestTimeout 30 -AllowFailure
        if ($poll.ExitCode -eq 0 -and $poll.Json) {
            $lastStatus = $poll.Json
            $status = $poll.Json.status
            if ($status -eq 'completed' -or $status -eq 'up_to_date') { break }
            if ($status -eq 'failed') { break }
        }
        Start-Sleep -Milliseconds 400
    }
    if (!$status) { throw "recompile status never returned within $TimeoutSeconds seconds. Last: $lastStatus" }
    $script:Stages['compile.recompile-wait'] = [math]::Round(((Get-Date) - $compileStart).TotalMilliseconds, 1)
    $script:Run.recompileStatus = $lastStatus
    if ($status -eq 'failed') { throw 'script recompile_status reported failed.' }

    Invoke-Stage 'compile.ready-after-reload' { Wait-EditorReady -Timeout 120 } | Out-Null
    $after = Invoke-Stage 'compile.console-after' { Get-ConsoleState }
    $delta = Invoke-Stage 'compile.console-delta' {
        Get-ConsoleErrorsSince -Cursor ([Nullable[long]]$before.cursor) -Session ([string]$before.session) -Since $compileStart
    }
    $newErrors = @($delta.entries)
    $compilationFailed = $false
    if ($after.groundTruth -and $after.groundTruth.compilationFailed) { $compilationFailed = $true }
    $script:Run.console = [ordered]@{
        before = [ordered]@{ cursor = $before.cursor; session = $before.session; counts = $before.counts }
        after = [ordered]@{ cursor = $after.cursor; session = $after.session; counts = $after.counts; compilationFailed = $compilationFailed }
        newErrors = @($newErrors | ForEach-Object { [ordered]@{ seq = $_.seq; message = $_.message; timestampUtc = $_.timestampUtc } })
    }
    Require-Check 'compilation-succeeded' (!$compilationFailed) ("console ground truth compilationFailed=$compilationFailed.")
    Require-Check 'no-new-compiler-errors' ($newErrors.Count -eq 0) "New console errors: $($newErrors.Count)."
    $script:Run.compiler = [ordered]@{ status = $status; errors = @($lastStatus.errors) }
    $script:Run.status = 'passed'
    Add-Check 'compile-status' $true "recompile_status=$status" | Out-Null
}

function Invoke-TestOperation {
    param([switch]$SkipCompile)
    $script:Run.operation = 'test'
    $script:Run.project = $script:Project
    $script:Run.editorVersion = $script:EditorVersion
    $script:Run.editorVersionRevision = $script:EditorVersionRevision
    $testRequest = [ordered]@{ mode = $Mode; filter = $TestFilter }
    $script:Run.request = $testRequest
    $script:Run.cli = $script:CliVersion

    Invoke-Stage 'test.ready' { Wait-EditorReady -Timeout 60 } | Out-Null
    if (!$SkipCompile) { Invoke-Stage 'test.compile' { Invoke-CompileOperation } | Out-Null }
    $script:Run.operation = 'test'
    $script:Run.request = $testRequest

    $started = Get-Date
    if ($Mode -eq 'EditMode') {
        $args = @('test', 'run', '--mode', 'editor')
        if ($TestFilter) { $args += @('--filter', $TestFilter) }
        $run = Invoke-EditorCommand -Command $args -Label 'test-run-editmode' -RequestTimeout ($TimeoutSeconds + 60) -AllowFailure -Lines
        $records = @($run.Records)
        $script:Run.test = [ordered]@{
            mode = 'EditMode'; filter = $TestFilter; exitCode = $run.ExitCode;
            records = @($records | ForEach-Object { [ordered]@{ fullName = $_.fullName; status = $_.status; duration = $_.duration; message = $_.message } })
        }
        $total = $records.Count
        $failed = @($records | Where-Object { $_.status -eq 'Failed' }).Count
        $passed = @($records | Where-Object { $_.status -eq 'Passed' }).Count
        $skipped = @($records | Where-Object { $_.status -eq 'Skipped' -or $_.status -eq 'Inconclusive' }).Count
        $script:Run.test.summary = [ordered]@{ total = $total; passed = $passed; failed = $failed; skipped = $skipped; duration = (($records | Measure-Object -Property duration -Sum).Sum) }
        if ($run.ExitCode -eq 2) { throw "No EditMode tests matched filter '$TestFilter'." }
        if ($total -eq 0) { throw "The EditMode run returned no test records (exit $($run.ExitCode)); treat it as incomplete." }
        if ($failed -gt 0 -or $run.ExitCode -ne 0) {
            $names = @($records | Where-Object { $_.status -eq 'Failed' } | ForEach-Object { $_.fullName }) -join ', '
            throw "EditMode tests failed: $failed/$total ($names)."
        }
    } else {
        $args = @('test', 'run', '--mode', 'playmode', '--async-tests', 'true')
        if ($TestFilter) { $args += @('--filter', $TestFilter) }
        $start = Invoke-EditorCommand -Command $args -Label 'test-run-playmode' -RequestTimeout 120 -AllowFailure
        if ($start.ExitCode -ne 0) { throw "PlayMode test run did not start: $(Format-CliError $start)" }
        Invoke-Stage 'test.ready-after-playmode' { Wait-EditorReady -Timeout 120 } | Out-Null
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        $status = $null
        while ((Get-Date) -lt $deadline) {
            $poll = Invoke-EditorCommand -Command @('test', 'status', '--detail', 'full') -Label 'test-status' -RequestTimeout 30 -AllowFailure
            if ($poll.Json) {
                $status = $poll.Json
                if ($status.status -eq 'completed' -or $status.status -eq 'failed' -or $status.status -eq 'no_tests') { break }
            }
            Start-Sleep -Milliseconds 500
        }
        if (!$status) { throw "PlayMode test status never finished within $TimeoutSeconds seconds." }
        $script:Run.test = [ordered]@{
            mode = 'PlayMode'; filter = $TestFilter; status = $status.status;
            summary = $status.summary;
            results = @($status.results | ForEach-Object { [ordered]@{ fullName = $_.fullName; status = $_.status; duration = $_.duration; message = $_.message } })
        }
        if ($status.status -eq 'no_tests') { throw "No PlayMode tests matched filter '$TestFilter'." }
        if ($status.status -eq 'failed') { throw "PlayMode test run failed." }
        $summary = $status.summary
        if (!$summary -or [int]$summary.total -le 0) { throw 'PlayMode test run returned no tests; treat it as incomplete.' }
        if ([int]$summary.failed -gt 0) { throw "PlayMode tests failed: $($summary.failed)/$($summary.total)." }
    }

    $delta = Invoke-Stage 'test.console-delta' {
        Get-ConsoleErrorsSince -Cursor $null -Session $null -Since $started
    }
    $script:Run.console = [ordered]@{
        newErrors = @($delta.entries | ForEach-Object { [ordered]@{ seq = $_.seq; message = $_.message; timestampUtc = $_.timestampUtc } })
    }
    Add-Check 'test-results' $true "mode=$Mode filter=$TestFilter" | Out-Null
    $script:Run.status = 'passed'
}

function Invoke-SmokeOperation {
    $script:Run.operation = 'smoke'
    $script:Run.project = $script:Project
    $script:Run.editorVersion = $script:EditorVersion
    $script:Run.editorVersionRevision = $script:EditorVersionRevision
    $script:Run.cli = $script:CliVersion
    $script:Run.request = [ordered]@{ demo = $Demo; ticks = $Ticks; repeat = !$NoRepeat; scene = $Scene }

    Invoke-Stage 'smoke.ready' { Wait-EditorReady -Timeout 60 } | Out-Null
    $fixture = Invoke-Stage 'smoke.fixture' { Get-Fixture -Id $Demo }
    if ($fixture.expectedSha256 -and $fixture.sha256 -ne $fixture.expectedSha256) {
        throw "Fixture hash $($fixture.sha256) does not match the manifest's $($fixture.expectedSha256); re-export the demos."
    }
    $script:Run.fixture = [ordered]@{
        id = $fixture.id; path = $fixture.relativePath; bytes = $fixture.bytes;
        sha256 = $fixture.sha256; expectedSha256 = $fixture.expectedSha256; counts = $fixture.counts
    }

    $scenes = Invoke-Stage 'smoke.scenes' { Get-SceneState }
    $dirty = @($scenes | Where-Object { $_.isDirty })
    if ($dirty.Count -gt 0) {
        $names = ($dirty | ForEach-Object { "$($_.name) ($($_.path))" }) -join ', '
        throw "Unsaved scene(s): $names. Save or discard them before the smoke check."
    }
    $active = @($scenes | Where-Object { $_.isActive })[0]
    $stationScene = "Assets/StationDesigner/Scenes/$Scene.unity"
    $editorState = Invoke-Stage 'smoke.editor-state' { Get-EditorState }
    if (!$active -or !([string]::Equals([IO.Path]::GetFullPath((Join-Path $script:Project $active.path)), [IO.Path]::GetFullPath((Join-Path $script:Project $stationScene)), [StringComparison]::OrdinalIgnoreCase))) {
        if ($editorState.playMode -eq 'playing') {
            Invoke-Stage 'smoke.stop-playmode-for-scene' {
                Invoke-EditorCommand -Command @('editor.playmode', 'stop') -Label 'playmode-stop' -RequestTimeout 60 | Out-Null
                Wait-PlayMode -Wanted 'stopped' -Timeout 60 | Out-Null
            } | Out-Null
        }
        Invoke-Stage 'smoke.open-station-scene' {
            Invoke-EditorCommand -Command @('scene', 'open', '--path', $stationScene) -Label 'scene-open' -RequestTimeout 120 | Out-Null
            Wait-EditorReady -Timeout 120 | Out-Null
        } | Out-Null
    }
    $editorState = Invoke-Stage 'smoke.playmode' {
        $state = Get-EditorState
        if ($state.playMode -ne 'playing') {
            Invoke-EditorCommand -Command @('editor.playmode', 'start', '--run-in-background', 'true') -Label 'playmode-start' -RequestTimeout 120 -AllowFailure | Out-Null
            Wait-EditorReady -Timeout 120 | Out-Null
            $state = Wait-PlayMode -Wanted 'playing' -Timeout 120
        }
        return $state
    }
    $script:Run.editor = [ordered]@{ version = $editorState.unityVersion; playMode = $editorState.playMode; codeLoadCount = $editorState.codeLoadCount; runInBackground = $editorState.runInBackground }
    Require-Check 'playmode-playing' ($editorState.playMode -eq 'playing') "editor playMode=$($editorState.playMode)" | Out-Null

    Invoke-Stage 'smoke.host' {
        # The CLI tokenizer strips bare double quotes from a structured argument;
        # escaped quotes survive as the JSON object the command expects.
        $condition = '{\"find-type\":\"Metro.App.StationGameHost\",\"member\":\"enabled\",\"op\":\"equals\",\"value\":true}'
        $wait = Invoke-EditorCommand -Command @('job', 'wait', '--condition', $condition, '--tolerate-missing', 'true', '--poll-interval-ms', '100') -Label 'wait-host' -RequestTimeout 60 -AllowFailure
        if ($wait.ExitCode -ne 0) { throw "StationGameHost never became available: $(Format-CliError $wait)" }
        if ($wait.Json -and $wait.Json.state -ne 'met') { throw "StationGameHost wait ended in state '$($wait.Json.state)'." }
    } | Out-Null

    $consoleBefore = Invoke-Stage 'smoke.console-before' { Get-ConsoleState }
    $smokeStart = Get-Date

    function Invoke-SmokeRun([int]$index) {
        $label = "smoke-run$index"
        $resultPath = Join-Path $script:Output "smoke-run$index.json"
        $shotPath = Join-Path $script:Output "game-view-run$index.png"
        $smoke = Invoke-EditorCommand -Command @('metro', 'station_smoke', '--demo', $Demo, '--ticks', "$Ticks", '--scene', $Scene, '--output-path', $resultPath) -Label $label -RequestTimeout ($TimeoutSeconds + 60) -AllowFailure
        $json = $smoke.Json
        if ($smoke.ExitCode -ne 0 -or !$json -or $json.status -ne 'passed') {
            $stage = if ($json -and $json.stage) { $json.stage } else { 'unknown' }
            $errorText = if ($json -and $json.error) { $json.error } else { Format-CliError $smoke }
            try {
                Invoke-EditorCommand -Command @('metro', 'station_smoke_finish') -Label "$label-finish" -RequestTimeout 60 -AllowFailure | Out-Null
            } catch { }
            throw "Smoke $index failed at stage '$stage': $errorText"
        }
        $capture = $null
        try {
            $capture = Invoke-EditorCommand -Command @('capture', 'game_view', '--source', 'screen', '--width', '1280', '--height', '720', '--output-path', $shotPath) -Label "$label-capture" -RequestTimeout 120 -AllowFailure
            if ($capture.ExitCode -ne 0) { throw "Game view capture failed: $(Format-CliError $capture)" }
        } finally {
            $finish = Invoke-EditorCommand -Command @('metro', 'station_smoke_finish') -Label "$label-finish" -RequestTimeout 60 -AllowFailure
            if ($finish.ExitCode -ne 0 -or !$finish.Json -or !$finish.Json.restored) {
                throw "Smoke $index could not restore the pre-run camera/time scale: $(Format-CliError $finish)"
            }
        }
        $png = Get-PngInfo -Path $shotPath
        if (!$png -or !$png.isPng -or $png.bytes -lt 1000) { throw "Smoke $index captured no usable PNG at $shotPath." }
        return [pscustomobject]@{ result = $json; capture = $capture.Json; png = $png; resultPath = $resultPath; shotPath = $shotPath }
    }

    $first = Invoke-Stage 'smoke.run1' { Invoke-SmokeRun 1 }
    $counts = $fixture.counts
    $document = $first.result.document
    Require-Check 'fixture-counts' (
        [int]$document.cells -eq [int]$counts.cells -and
        [int]$document.modules -eq [int]$counts.modules -and
        [int]$document.lines -eq [int]$counts.lines
    ) "cells/modules/lines $($document.cells)/$($document.modules)/$($document.lines), manifest $($counts.cells)/$($counts.modules)/$($counts.lines)." | Out-Null
    $runs = @($first)
    if (!$NoRepeat) {
        $second = Invoke-Stage 'smoke.run2' { Invoke-SmokeRun 2 }
        $runs += $second
        Require-Check 'repeat-state' ($first.result.state.hash -eq $second.result.state.hash) "Run 1 hash $($first.result.state.hash), run 2 hash $($second.result.state.hash)." | Out-Null
        Add-Check 'repeat-capture' ($second.png.isPng -and $second.png.width -gt 0) "Run 2 screenshot: $($second.png.width)x$($second.png.height), $($second.png.bytes) bytes." | Out-Null
    }

    $consoleAfter = Invoke-Stage 'smoke.console-after' { Get-ConsoleState }
    $delta = Invoke-Stage 'smoke.console-delta' {
        Get-ConsoleErrorsSince -Cursor ([Nullable[long]]$consoleBefore.cursor) -Session ([string]$consoleBefore.session) -Since $smokeStart
    }
    $script:Run.console = [ordered]@{
        before = [ordered]@{ cursor = $consoleBefore.cursor; session = $consoleBefore.session; counts = $consoleBefore.counts }
        after = [ordered]@{ cursor = $consoleAfter.cursor; session = $consoleAfter.session; counts = $consoleAfter.counts; compilationFailed = $consoleAfter.groundTruth.compilationFailed }
        newErrors = @($delta.entries | ForEach-Object { [ordered]@{ seq = $_.seq; message = $_.message; timestampUtc = $_.timestampUtc } })
    }
    Require-Check 'console-clean' (@($delta.entries).Count -eq 0) "New Console errors: $(@($delta.entries).Count)." | Out-Null
    $compilationFailed = [bool]($consoleAfter.groundTruth -and $consoleAfter.groundTruth.compilationFailed)
    Require-Check 'compilation-clean' (!$compilationFailed) "compilationFailed=$compilationFailed." | Out-Null

    $script:Run.smoke = [ordered]@{
        demo = $Demo; ticks = $Ticks;
        fixture = $first.result.fixture;
        document = $first.result.document;
        stateHash = $first.result.state.hash;
        simulation = $first.result.simulation;
        checks = @($first.result.checks);
        screenshots = @($runs | ForEach-Object { [ordered]@{ path = $_.png.path; bytes = $_.png.bytes; width = $_.png.width; height = $_.png.height; sha256 = $_.png.sha256 } });
        repeated = (!$NoRepeat)
    }
    if (!$NoRepeat) { $script:Run.smoke.repeatStateHash = $runs[1].result.state.hash }

    $scenesAfter = Invoke-Stage 'smoke.scenes-after' { Get-SceneState }
    $stationOpen = @($scenesAfter | Where-Object { $_.path -eq $stationScene }) | Select-Object -First 1
    Require-Check 'station-scene-open' ($null -ne $stationOpen) "StationGame scene present=$($null -ne $stationOpen)." | Out-Null
    $stationDirty = [bool]($stationOpen -and $stationOpen.isDirty)
    Require-Check 'station-scene-clean' (!$stationDirty) "StationGame scene dirty=$stationDirty." | Out-Null

    if ($StopAfter) {
        Invoke-Stage 'smoke.stop-after' {
            Invoke-EditorCommand -Command @('editor.playmode', 'stop') -Label 'playmode-stop-after' -RequestTimeout 60 -AllowFailure | Out-Null
            Wait-PlayMode -Wanted 'stopped' -Timeout 60 | Out-Null
        } | Out-Null
    }

    $statusAfter = @(& git -C $repo status --porcelain -- unity/Assets unity/Packages unity/ProjectSettings unity/scripts 2>$null)
    $script:Run.assets = [ordered]@{
        before = $script:UnityStatusBefore
        after = $statusAfter
        clean = (($script:UnityStatusBefore -join "`n") -eq ($statusAfter -join "`n"))
    }
    Require-Check 'assets-unchanged' $script:Run.assets.clean "Unity project changes before=$($script:UnityStatusBefore.Count), after=$($statusAfter.Count)." | Out-Null
    $script:Run.status = 'passed'
}

function Invoke-VerifyOperation {
    if (!$TestFilter) {
        $script:FailedStage = 'request'
        throw 'verify requires -TestFilter so the one-command loop names the test it ran. Use -Mode/-TestFilter with test for a larger suite.'
    }
    $request = [ordered]@{ operation = 'verify'; testFilter = $TestFilter; demo = $Demo; ticks = $Ticks; scene = $Scene }
    $script:Run.operation = 'verify'
    $script:Run.request = $request

    Invoke-Stage 'verify.compile' { Invoke-CompileOperation } | Out-Null
    $script:Run.operation = 'verify'; $script:Run.request = $request
    Invoke-Stage 'verify.test' { Invoke-TestOperation -SkipCompile } | Out-Null
    $script:Run.operation = 'verify'; $script:Run.request = $request
    Invoke-Stage 'verify.smoke' { Invoke-SmokeOperation } | Out-Null
    $script:Run.operation = 'verify'; $script:Run.request = $request

    $script:Run.verify = [ordered]@{
        compile = $script:Run.compiler
        test = $script:Run.test
        smoke = $script:Run.smoke
    }
    $script:Run.status = 'passed'
}

# ---------------------------------------------------------------------- main

$script:Run = [ordered]@{
    schemaVersion = 1
    runId = $script:RunId
    operation = $Operation
    status = 'running'
    stage = $null
    startedAt = $script:StartedAt.ToString('o')
    repo = $repo
    project = $project
    editorVersion = $editorVersion
    editorVersionRevision = $editorVersionRevision
    source = [ordered]@{
        head = $script:Head
        dirty = ($script:StatusBefore.Count -gt 0)
        unityDirty = ($script:UnityStatusBefore.Count -gt 0)
        dirtyPaths = @($script:StatusBefore | Select-Object -First 100)
    }
    request = [ordered]@{ operation = $Operation }
    evidence = [ordered]@{ run = $runPath; logs = $logDir }
}

$exitCode = 0
try {
    $script:Run.cli = Get-UnityCliVersion
    switch ($Operation) {
        'status'  { Invoke-StatusOperation }
        'compile' { Invoke-CompileOperation }
        'test'    { Invoke-TestOperation }
        'smoke'   { Invoke-SmokeOperation }
        'verify'  { Invoke-VerifyOperation }
    }
    if ($script:Run.status -eq 'failed') { $exitCode = 1 }
    else { $script:Run.status = 'passed' }
} catch {
    $exitCode = 1
    if (!$script:FailedStage) { $script:FailedStage = 'unexpected' }
    $script:Run.status = 'failed'
    $script:Run.stage = $script:FailedStage
    $script:Run.error = $_.Exception.Message
    Write-Host "metro-editor $Operation failed at stage '$($script:FailedStage)': $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($script:Run.status -eq 'running') { $script:Run.status = 'failed' }
    Write-RunFile
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

$summary = [ordered]@{
    operation = $Operation
    status = $script:Run.status
    runId = $script:RunId
    stage = $script:Run.stage
    artifact = $runPath
    error = $script:Run.error
    ready = $script:Run.ready
    checks = $script:Checks
    stages = $script:Stages
}
if ($script:Run.smoke) { $summary.smoke = $script:Run.smoke }
if ($script:Run.test) { $summary.test = $script:Run.test }
if ($script:Run.console) { $summary.console = $script:Run.console }
$summary | ConvertTo-Json -Depth 12
exit $exitCode
