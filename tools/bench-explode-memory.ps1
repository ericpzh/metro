param([Parameter(Mandatory=$true)][string]$SavePath)
# Sample the Chrome processes belonging to this benchmark's temporary profile.
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = Join-Path $root '.preview/perf/explode-memory'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$save = (Resolve-Path -LiteralPath $SavePath).Path
$job = Start-Job -ArgumentList $root,$save -ScriptBlock {
  param($repo,$fixture)
  Set-Location $repo
  $env:BENCH_PROFILE='0'
  $env:BENCH_MEMORY_HANDOFF='1'
  $env:BENCH_OUTPUT='.preview/perf/explode-memory'
  node tools/bench-explode-generation.mjs $fixture *> .preview/explode-memory.log
  if ($LASTEXITCODE -ne 0) { throw "Benchmark failed with exit code $LASTEXITCODE" }
}
$records = [System.Collections.Generic.List[object]]::new()
try {
  while ($job.State -eq 'Running') {
    $processes = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*explode-memory*chrome-*' }
    foreach ($process in $processes) {
      $kind = if ($process.CommandLine -match '--type=([^ ]+)') { $Matches[1] } else { 'browser' }
      $sample = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
      if ($sample) {
        $records.Add([pscustomobject]@{time=(Get-Date).ToUniversalTime().ToString('o');pid=$process.ProcessId;kind=$kind;workingSet=$sample.WorkingSet64;privateBytes=$sample.PrivateMemorySize64})
      }
    }
    Start-Sleep -Seconds 1
  }
  $records | ConvertTo-Json | Set-Content (Join-Path $output 'processes.json')
  Receive-Job $job
  if ($job.State -eq 'Failed') { throw 'Browser benchmark failed. See .preview/explode-memory.log.' }
} finally {
  Remove-Job $job -Force
}
