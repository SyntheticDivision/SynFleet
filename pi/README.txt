SynFleet Raspberry Pi package
============================

This archive is the app source plus the Pi installer. It is not a Windows .exe,
and it does not include node_modules. Those must be installed on the Pi so the
native pieces match the Pi's CPU.

Needs
- Raspberry Pi 4 or 5, 64-bit Raspberry Pi OS
- Node.js 22 or newer
- The Pi on the same LAN as the miners

From Windows (this Pi)
1. In the SynFleet preview, click Pi update. Save synfleet-pi.tar into:
     C:\Users\Alex1\Desktop\Youtube video\SynFleet\Version 0.07
2. Click Update bat. Save update-pi.bat into that same folder.
3. Double-click update-pi.bat.
   It copies the archive to syntheticdivision@192.168.0.236 and runs
   pi/install.sh. Enter the Pi password when asked.
4. Open http://192.168.0.236:8080

Install by hand, once the hardware is up
1. Copy this folder to the Pi, for example /home/syntheticdivision/synfleet
2. From that folder:
     chmod +x pi/install.sh
     ./pi/install.sh
3. Open http://<pi-ip>:8080 from a phone or laptop on the same network.

The installer builds a Node server, copies it to /opt/synfleet, and starts a
systemd service named synfleet. Bench miners are off in this build.

Logs: journalctl -u synfleet -f
Stop: sudo systemctl stop synfleet
