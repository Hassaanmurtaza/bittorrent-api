$ErrorActionPreference = "Stop"

$localNode = "C:\Users\Coffee Lake\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path $localNode) {
  & $localNode server.js
  exit $LASTEXITCODE
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source server.js
  exit $LASTEXITCODE
}

Write-Error "Node.js was not found. Install Node.js 18+ or run with the bundled Codex Node path."
