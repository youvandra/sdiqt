#!/usr/bin/env bash
# Ship the watchtower bundle to the host and restart it. Builds on the Mac only;
# the host runs plain node and installs nothing.
#   deploy/deploy.sh [user@host]   (default ubuntu@43.134.86.221)
set -euo pipefail
HOST="${1:-ubuntu@43.134.86.221}"
cd "$(dirname "$0")/.."

node apps/watchtower/scripts/bundle.mjs deploy/dist
rsync -az --delete deploy/dist/ "$HOST:/srv/sdiqt/app/"
rsync -az deploy/systemd/sdiqt-watchtower.service deploy/systemd/sdiqt-fleet.service "$HOST:/tmp/"
rsync -az deploy/nginx/sdiqt.xyz.conf "$HOST:/tmp/sdiqt.xyz.conf"
ssh "$HOST" 'set -e
  sudo install -m 644 /tmp/sdiqt-watchtower.service /etc/systemd/system/sdiqt-watchtower.service
  sudo install -m 644 /tmp/sdiqt-fleet.service /etc/systemd/system/sdiqt-fleet.service
  if ! sudo test -f /etc/nginx/sites-available/sdiqt.xyz; then
    sudo install -m 644 /tmp/sdiqt.xyz.conf /etc/nginx/sites-available/sdiqt.xyz
    sudo ln -sf /etc/nginx/sites-available/sdiqt.xyz /etc/nginx/sites-enabled/sdiqt.xyz
  fi
  sudo nginx -t && sudo systemctl reload nginx
  sudo systemctl daemon-reload
  sudo systemctl enable --now sdiqt-watchtower
  sudo systemctl restart sdiqt-watchtower
  sudo systemctl enable --now sdiqt-fleet
  sudo systemctl restart sdiqt-fleet
  sleep 3
  systemctl is-active sdiqt-watchtower sdiqt-fleet'
