$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$localNode = "C:\Users\Coffee Lake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$pidFile = Join-Path $root "bridge.pid"

if (!(Test-Path $localNode)) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (!$node) {
    Write-Error "Node.js was not found. Install Node.js 18+ or run start.ps1 from Codex's bundled runtime."
  }
  $localNode = $node.Source
}

$existing = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7331 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
  Write-Host "Bridge is already running at http://127.0.0.1:7331 (PID $($existing.OwningProcess))."
  exit 0
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $localNode
$psi.Arguments = "server.js"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

$process = [System.Diagnostics.Process]::Start($psi)
$process.Id | Set-Content -Path $pidFile -Encoding ascii

Start-Sleep -Seconds 1
$health = Invoke-RestMethod -Uri "http://127.0.0.1:7331/health" -TimeoutSec 3
if (!$health.ok) {
  Write-Error "Bridge started but did not report healthy."
}

Write-Host "Bridge running at http://127.0.0.1:7331 (PID $($process.Id))."
