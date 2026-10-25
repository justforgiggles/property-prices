#!/usr/bin/env bash
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo 'Run with sudo: sudo bash scripts/install-rpi-scraper.sh [--no-enable-timer]' >&2
  exit 1
fi
enable_timer=true
if [ "${1:-}" = --no-enable-timer ] && [ "$#" -eq 1 ]; then
  enable_timer=false
elif [ "$#" -ne 0 ]; then
  echo 'Usage: install-rpi-scraper.sh [--no-enable-timer]' >&2
  exit 1
fi
if [ "$(uname -m)" != aarch64 ]; then
  echo 'This installer requires Debian ARM64.' >&2
  exit 1
fi

scraper_user=office
scraper_home=$(getent passwd "$scraper_user" | cut -d: -f6)
checkout="$scraper_home/prop-radar"
key="$scraper_home/.ssh/prop-radar"
known_hosts="$scraper_home/.ssh/prop-radar-known-hosts"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl xz-utils ca-certificates python3

node_version=22.22.0
if ! /usr/local/bin/node --version 2>/dev/null | grep -qx "v$node_version"; then
  download=$(mktemp -d)
  trap 'rm -rf "$download"' EXIT
  archive="node-v${node_version}-linux-arm64.tar.xz"
  curl --fail --retry 3 -sS "https://nodejs.org/dist/v${node_version}/$archive" -o "$download/$archive"
  curl --fail --retry 3 -sS "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$download/SHASUMS256.txt"
  (cd "$download"; grep " $archive\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$download/$archive" --strip-components=1 -C /usr/local
fi

install -d -m 0700 -o "$scraper_user" -g "$scraper_user" "$scraper_home/.ssh"
if [ ! -f "$key" ]; then
  runuser -u "$scraper_user" -- ssh-keygen -q -t ed25519 -N '' -C 'Prop Radar' -f "$key"
fi
curl --fail --retry 3 -sS https://api.github.com/meta | python3 -c 'import json,sys; print("".join("github.com " + key + "\n" for key in json.load(sys.stdin)["ssh_keys"]), end="")' > "$known_hosts"
chown "$scraper_user:$scraper_user" "$known_hosts"
chmod 0600 "$key" "$known_hosts"
ssh_command="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts"
repository=git@github.com:justforgiggles/property-prices.git
if ! runuser -u "$scraper_user" -- env GIT_SSH_COMMAND="$ssh_command" git ls-remote "$repository" HEAD >/dev/null; then
  echo 'Register this public key as a write-enabled deploy key on justforgiggles/property-prices, then rerun:' >&2
  cat "$key.pub"
  exit 1
fi

if [ ! -d "$checkout" ]; then
  runuser -u "$scraper_user" -- env GIT_SSH_COMMAND="$ssh_command" git clone --branch main "$repository" "$checkout"
fi
runuser -u "$scraper_user" -- git -C "$checkout" config core.sshCommand "$ssh_command"
runuser -u "$scraper_user" -- git -C "$checkout" config user.name 'Prop Radar'
runuser -u "$scraper_user" -- git -C "$checkout" config user.email 'scraper@users.noreply.github.com'
runuser -u "$scraper_user" -- git -C "$checkout" pull --rebase origin main
runuser -u "$scraper_user" -- env PATH=/usr/local/bin:/usr/bin:/bin bash -c 'cd "$1"; npm ci --workspace @prop-radar/data --include-workspace-root=false --include=dev' -- "$checkout"

cat > /etc/systemd/system/prop-radar.service <<EOF
[Unit]
Description=Prop Radar scraping
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$scraper_user
WorkingDirectory=$checkout
Environment=HOME=$scraper_home
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash $checkout/scripts/scrape.sh
TimeoutStartSec=infinity
Restart=no
EOF
cat > /etc/systemd/system/prop-radar.timer <<'EOF'
[Unit]
Description=Daily Prop Radar scrape at 10:00 SAST

[Timer]
OnCalendar=*-*-* 10:00:00 Africa/Johannesburg
AccuracySec=1s
Persistent=false
Unit=prop-radar.service

[Install]
WantedBy=timers.target
EOF
systemd-analyze verify /etc/systemd/system/prop-radar.service /etc/systemd/system/prop-radar.timer
systemctl daemon-reload
if [ "$enable_timer" = true ]; then
  systemctl enable --now prop-radar.timer
  systemctl list-timers prop-radar.timer --no-pager
else
  echo 'Installed with timer activation deferred. Enable after acceptance: sudo systemctl enable --now prop-radar.timer'
fi
