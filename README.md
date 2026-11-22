# SynFleet

Home-solo miner console. It runs as a kiosk on a Raspberry Pi (or on a Windows PC on the same network) and watches small SHA-256 boards on the LAN. After 30 seconds with nobody touching the screen, the top bar hides: miners stay on the left, your own photos play on the right.

This is the home-solo Pi build saved 21 Oct 2026, after the Pi screen was confirmed working.

## Hardware

### The console (where SynFleet is hosted)

SynFleet is hosted on a **Raspberry Pi**, not on the miners. The Pi is the always-on computer. A screen on that Pi is the kiosk. Miners stay on the LAN and are only polled.

| Piece | This build |
| --- | --- |
| Host | Raspberry Pi 4 or Pi 5, 64-bit Raspberry Pi OS, with a display. This copy was confirmed on a Pi screen on 21 Oct 2026. |
| Home unit | User `syntheticdivision`, address `192.168.0.236`. Console: http://192.168.0.236:8080 |
| Install path on the Pi | Source checkout `/home/syntheticdivision/synfleet`. Running service `/opt/synfleet`. |
| Service | systemd unit `synfleet`, port **8080**, bound on the Pi so other devices on the LAN can open it. |
| Also runs on | Windows 10 or 11 with Node.js 22, same LAN. That is a second host for trying the console, not the kiosk. |
| Network | The Pi (or Windows PC) and the miners must be on the same local network. Scan does not leave the subnet you set. |

Node.js **22 or newer** is required on the host. `node_modules` is not in this repo. Install them on the Pi (or the Windows PC) so the native packages match that CPU.

### Miners it talks to

Home-solo boards only. Press **Scan** on the Pi, or add a board by hand.

| In the Add dialog | Hardware | Default port |
| --- | --- | --- |
| Bitaxe / ESP | Bitaxe and other ESP-Miner / AxeOS boards | 80 |
| cgminer | Boards that speak the cgminer API | 4028 |
| Avalon Nano | Canaan Avalon Nano | 4028 |
| Avalon TNA | Canaan Avalon TNA | 80 |
| Hammer | Hammer / Thor boards: **Thor X1, BC01, BC04, DC02**. Needs the board API token. | 80 |
| Harlo | Harlo | 80 |
| Satboy | Greenbit Satboy | 30110 |

Fan, voltage, pool save, and restart are sent to that device. Other computers do not need the display open.

**Not in this build.** Farm firmware is ignored on purpose: Whatsminer, Antminer, Braiins, LuxOS, and VNish.

## Install on a Raspberry Pi

The Pi needs Node.js 22. If it is missing:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Clone and install. The script builds on the Pi, copies the app to `/opt/synfleet`, and starts the service.

```sh
git clone https://github.com/SyntheticDivision/SynFleet.git
cd SynFleet
chmod +x pi/install.sh
./pi/install.sh
```

Open `http://<pi-ip>:8080` from a phone or laptop on the same network.

```sh
journalctl -u synfleet -f     # logs
sudo systemctl stop synfleet  # stop
sudo systemctl restart synfleet
```

`update-pi.bat` and `pi/README.txt` are the home update path for one Pi (`syntheticdivision@192.168.0.236`). Change `HOST` in `update-pi.bat` if your Pi address is different. A normal install does not need that script. Use `./pi/install.sh` on the Pi.

## Install on Windows

Needs Windows 10 or 11 and Node.js 22 from [nodejs.org](https://nodejs.org/).

```powershell
git clone https://github.com/SyntheticDivision/SynFleet.git
cd SynFleet
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\windows\install.ps1
.\windows\start.bat
```

Open http://localhost:8080. Leave the black window open. Close it to stop. Other machines on the LAN can use `http://<this-pc-ip>:8080`.

## Develop

```sh
npm install
npm run dev
```

The dev server listens on port 8080.

## Your photos on the idle side panel

There is no upload button. Name the files and put them in `public/idle/`.

The panel turns on after **30 seconds** with no touch, click, scroll, or key. The top bar hides. Miners stay on the left (about three fifths of the screen). Photos fill the right (about two fifths). Each photo stays for **8 seconds**, in alphabetical file-name order, then the show repeats. Touch the screen to leave idle mode.

### Naming

| Rule | Use this |
| --- | --- |
| Folder | `public/idle/` and nowhere else. No subfolders. |
| Types | `.jpg` `.jpeg` `.png` `.webp` `.gif` |
| Pattern | Two digits, then the extension: `01.jpg`, `02.jpg`, `03.png` |
| Why two digits | Names sort A to Z. `10.jpg` would play before `2.jpg`. `01` … `14` stays in the order you mean. |
| Other names | Allowed (`night-rack.webp`) as long as the name is a single file name, has an extension, and does not start with a dot. |
| Skipped | Hidden files (`.something.jpg`), files with no extension, and anything that is not one of the types above. |

The sample set in this repo is `01.jpg` through `14.jpg`. Replace those files or add new ones. Delete a file to take it off the panel.

Full steps, including where to copy files on a Pi that is already running, are in [public/idle/README.md](public/idle/README.md).

On a live Pi, copy new pictures into `/opt/synfleet/public/idle/` and `/opt/synfleet/.output/public/idle/`, then `sudo systemctl restart synfleet`.
