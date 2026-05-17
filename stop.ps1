$ErrorActionPreference = "Stop"

$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7331 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$connection) {
  Write-Host "Bridge is not running."
  exit 0
}

Stop-Process -Id $connection.OwningProcess -ErrorAction Stop
Write-Host "Stopped bridge process $($connection.OwningProcess)."
