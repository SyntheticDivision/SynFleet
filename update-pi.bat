@echo off
setlocal
set "HOST=syntheticdivision@192.168.0.236"
set "DROP=C:\Users\Alex1\Desktop\Youtube video\SynFleet\Version 0.07"
set "SRC="
if exist "%DROP%\synfleet-pi.tar" set "SRC=%DROP%\synfleet-pi.tar"
if exist "%DROP%\synfleet-pi.tar.gz" set "SRC=%DROP%\synfleet-pi.tar.gz"
if not defined SRC (
  echo No synfleet-pi.tar in:
  echo   %DROP%
  echo In the SynFleet preview, click Pi update, then save the file into that folder.
  pause
  exit /b 1
)
for %%F in ("%SRC%") do set "NAME=%%~nxF"
echo Sending "%SRC%" to %HOST%
scp "%SRC%" %HOST%:/tmp/%NAME%
if errorlevel 1 (
  echo Copy failed.
  pause
  exit /b 1
)
echo Installing on the Pi. Enter the Pi password if asked.
ssh -t %HOST% "set -e; rm -rf /home/syntheticdivision/synfleet; mkdir -p /home/syntheticdivision/synfleet; tar -xf /tmp/%NAME% -C /home/syntheticdivision/synfleet; cd /home/syntheticdivision/synfleet; chmod +x pi/install.sh; ./pi/install.sh"
echo.
echo When that finishes, open http://192.168.0.236:8080 and refresh.
pause
