$ErrorActionPreference = "Stop"

$localNode = "C:\Users\Coffee Lake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path $localNode) {
  & $localNode poller.js
  exit $LASTEXITCODE
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source poller.js
  exit $LASTEXITCODE
}

Write-Error "Node.js was not found."
