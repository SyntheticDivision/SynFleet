#!/bin/sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. On Raspberry Pi OS:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y rsync
fi

echo "Installing SynFleet for this Pi (arm packages build here, not on another PC)..."
npm install
export PATH="$ROOT/node_modules/.bin:$PATH"
NITRO_PRESET=node VITE_FLEET_BENCH=false node scripts/with-app-env.mjs vite build
node scripts/migrate.mjs || true

sudo mkdir -p /opt/synfleet
sudo rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude artifacts \
  --exclude screenshots \
  --exclude attachments \
  "$ROOT/" /opt/synfleet/
if [ -d "$ROOT/node_modules" ]; then
  sudo rsync -a "$ROOT/node_modules/" /opt/synfleet/node_modules/
fi
if [ -d "$ROOT/.output" ]; then
  sudo rsync -a "$ROOT/.output/" /opt/synfleet/.output/
fi
sudo cp "$ROOT/pi/synfleet.service" /etc/systemd/system/synfleet.service
sudo systemctl daemon-reload
sudo systemctl enable synfleet
sudo systemctl restart synfleet
echo "SynFleet is on http://$(hostname -I | awk '{print $1}'):8080"
