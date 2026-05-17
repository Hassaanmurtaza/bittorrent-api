$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "qBittorrent Relay Poller"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "Removed scheduled task: $taskName" -ForegroundColor Green
} else {
  Write-Host "Scheduled task '$taskName' was not registered."
}

$vbsPath = Join-Path $root "poll-background.vbs"
if (Test-Path $vbsPath) {
  Remove-Item $vbsPath -Force
}

# Kill any lingering poller node processes the task spawned.
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*poller.js*" }
foreach ($p in $running) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped running poller (PID $($p.ProcessId))."
}
