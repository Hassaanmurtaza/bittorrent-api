$ErrorActionPreference = "Stop"

$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 7331 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$connection) {
  Write-Host "Bridge is not running on http://127.0.0.1:7331."
  exit 1
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:7331/health" -TimeoutSec 3
  if ($health.ok) {
    Write-Host "Bridge is running at http://127.0.0.1:7331 (PID $($connection.OwningProcess))."
    exit 0
  }
} catch {
  Write-Host "Something is listening on port 7331, but the bridge health check failed."
  exit 1
}
