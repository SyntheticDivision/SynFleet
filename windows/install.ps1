$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 22 or newer is required."
  Write-Host "Install it from https://nodejs.org/ then run this script again."
  exit 1
}

Write-Host "Installing SynFleet for this Windows PC..."
npm ci
$env:Path = "$Root\node_modules\.bin;" + $env:Path
$env:NITRO_PRESET = "node"
node scripts/with-app-env.mjs vite build
node scripts/migrate.mjs
if ($LASTEXITCODE -ne 0) { Write-Host "Database migrate skipped or failed. The console can still start." }

Write-Host ""
Write-Host "Built. Start it with:"
Write-Host "  .\windows\start.bat"
Write-Host "Then open http://localhost:8080"
