#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Exécutez ce script avec sudo depuis /opt/homedash." >&2
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ "${PROJECT_ROOT}" != "/opt/homedash" ]]; then
  echo "Le dépôt doit être installé dans /opt/homedash (actuel: ${PROJECT_ROOT})." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker manque. Suivez docs/installation-raspberry-pi.md avant de continuer." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 LTS manque sur l'hôte; il est requis uniquement pour l'agent de rollback." >&2
  exit 1
fi

getent group homedash >/dev/null || groupadd --system homedash
id homedash-updater >/dev/null 2>&1 || useradd --system --gid homedash --groups docker --home-dir /var/lib/homedash --shell /usr/sbin/nologin homedash-updater
usermod -aG docker,homedash homedash-updater

install -d -o homedash-updater -g homedash -m 2770 /var/lib/homedash/data /var/lib/homedash/data/backups
install -d -o root -g homedash -m 0750 /etc/homedash
install -d -o homedash-updater -g homedash -m 0770 /run/homedash-updater

if [[ ! -f /etc/homedash/updater-token ]]; then
  openssl rand -hex 32 | tr -d '\n' > /etc/homedash/updater-token
  chown root:homedash /etc/homedash/updater-token
  chmod 0640 /etc/homedash/updater-token
fi

HOMEDASH_GID="$(getent group homedash | cut -d: -f3)"
if [[ ! -f /var/lib/homedash/data/release.env ]]; then
  cp deployment/docker/.release.env.example /var/lib/homedash/data/release.env
fi
sed -i "s/^HOMEDASH_HOST_GID=.*/HOMEDASH_HOST_GID=${HOMEDASH_GID}/" /var/lib/homedash/data/release.env
chown homedash-updater:homedash /var/lib/homedash/data/release.env
chmod 0640 /var/lib/homedash/data/release.env

install -o root -g root -m 0644 deployment/raspberry-pi/homedash-updater.service /etc/systemd/system/homedash-updater.service
install -o root -g root -m 0644 deployment/raspberry-pi/homedash.service /etc/systemd/system/homedash.service
systemctl daemon-reload
systemctl enable homedash-updater.service homedash.service

echo "Services HomeDash installés. Configurez /etc/homedash/homedash.env puis lancez:"
echo "  sudo systemctl start homedash-updater homedash"
