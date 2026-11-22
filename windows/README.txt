SynFleet Windows package
=======================

This archive is the app source plus a Windows installer. It is not a single
.exe. Node has to install the packages on this PC.

Needs
- Windows 10 or 11
- Node.js 22 or newer from https://nodejs.org/

Install
1. Unzip this folder, for example to C:\SynFleet
2. Open PowerShell in that folder
3. If scripts are blocked, once:
     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
4. Run:
     .\windows\install.ps1
5. Start the console:
     .\windows\start.bat
6. Open http://localhost:8080

Leave the black window open while you use SynFleet. Close it to stop the app.
Other computers on the same network can use http://<this-pc-ip>:8080

The demo miners are included so you can click around before hardware is on
the LAN. Scan still looks for real miners on this network.
