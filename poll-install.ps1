$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskName = "qBittorrent Relay Poller"

# Find node.exe (same lookup order as poll.ps1).
$localNode = "C:\Users\Coffee Lake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (!(Test-Path $localNode)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (!$cmd) {
    Write-Error "Node.js was not found. Install Node.js 18+ or fix the localNode path in this script."
    exit 1
  }
  $localNode = $cmd.Source
}

# Write a tiny VBS launcher so node.exe runs with no visible window (avoids the
# console flash you'd get from launching powershell.exe / node.exe directly).
$vbsPath = Join-Path $root "poll-background.vbs"
$nodeEscaped = $localNode -replace '"', '""'
$rootEscaped = $root -replace '"', '""'
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$rootEscaped"
WshShell.Run """$nodeEscaped"" poller.js", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ascii

# Drop any pre-existing task with the same name so re-running this script is idempotent.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Polls the Vercel torrent relay and hands queued links to local qBittorrent." | Out-Null

Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Installed scheduled task: $taskName" -ForegroundColor Green
Write-Host "It is running hidden in the background now, and will auto-start every time you log in."
Write-Host ""
Write-Host "Check status:  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "Stop now:      Stop-ScheduledTask -TaskName '$taskName'"
Write-Host "Start now:     Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Uninstall:     .\poll-uninstall.ps1"
