# Upload the SynFleet Pi archive and install it.
# Put synfleet-pi.tar in the version folder, then from PowerShell:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\Alex1\Desktop\Youtube video\SynFleet\Version 0.07\update-pi.ps1"
$ErrorActionPreference = "Stop"

$PiUser = "syntheticdivision"
$PiHost = "192.168.0.236"
$Target = "${PiUser}@${PiHost}"
$RemoteDir = "/home/syntheticdivision/synfleet"
$Drop = "C:\Users\Alex1\Desktop\Youtube video\SynFleet\Version 0.07"

function Find-Archive {
  $names = @("synfleet-pi.tar", "synfleet-pi.tar.gz")
  foreach ($name in $names) {
    $path = Join-Path $Drop $name
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}

if (-not (Get-Command scp -ErrorAction SilentlyContinue) -or -not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Write-Host "OpenSSH is required. On Windows: Settings, Apps, Optional features, OpenSSH Client."
  exit 1
}

$Src = Find-Archive
if (-not $Src) {
  Write-Host "No synfleet-pi.tar in:"
  Write-Host "  $Drop"
  Write-Host "In the SynFleet preview, click Pi update, then save the file into that folder."
  exit 1
}

$name = Split-Path -Leaf $Src
Write-Host "Sending $Src to ${Target}"
scp $Src "${Target}:/tmp/$name"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Copy failed."
  exit 1
}

Write-Host "Installing on the Pi. Enter the Pi password if asked."
ssh -t $Target "set -e; rm -rf '$RemoteDir'; mkdir -p '$RemoteDir'; tar -xf '/tmp/$name' -C '$RemoteDir'; cd '$RemoteDir'; chmod +x pi/install.sh; ./pi/install.sh"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Install failed."
  exit 1
}

Write-Host ""
Write-Host "When that finishes, open http://${PiHost}:8080 and refresh."
