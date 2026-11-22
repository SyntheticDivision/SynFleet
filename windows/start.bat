@echo off
setlocal
cd /d "%~dp0\.."
if not exist ".output\server\index.mjs" (
  echo SynFleet is not built yet. Run windows\install.ps1 first.
  exit /b 1
)
set PORT=8080
set HOST=0.0.0.0
set NITRO_PORT=8080
set NITRO_HOST=0.0.0.0
echo SynFleet on http://localhost:8080
node .output\server\index.mjs
