#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 || "$(uname -s)" != Linux || "$#" -gt 1 || ( "$#" -eq 1 && "$1" != --from-update ) ]]; then
  echo "Usage, sur le Pi : sudo bash deployment/raspberry-pi-zero/install-reliability.sh" >&2
  exit 1
fi
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f /etc/homedash/homedash.env || ! -f /usr/local/lib/homedash/native-updater-agent.mjs ]]; then
  echo "Installez d'abord HomeDash natif avec install-native.sh." >&2
  exit 1
fi
command -v flock >/dev/null || { echo "flock manque : sudo apt install util-linux" >&2; exit 1; }

if [[ "${1:-}" != --from-update ]]; then
  exec 9>/run/homedash-maintenance.lock
  if ! flock --nonblock 9; then
    echo "Une mise à jour est en cours. Attendez sa fin, puis relancez cette commande." >&2
    exit 1
  fi
  # Old installed updaters do not yet acquire the maintenance lock.
  if pgrep -f '(^|/)(ba)?sh /usr/local/sbin/homedash-update-native( |$)' >/dev/null; then
    echo "L'ancien installeur est en cours. Attendez sa fin, puis relancez cette commande." >&2
    exit 1
  fi
fi

# Replace the file atomically: an updater already executing it must keep its old inode.
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/update-native.sh" /usr/local/sbin/.homedash-update-native-next
mv -f /usr/local/sbin/.homedash-update-native-next /usr/local/sbin/homedash-update-native
install -o root -g root -m 0755 "${SCRIPT_DIRECTORY}/homedash-nightly-reboot" /usr/local/sbin/homedash-nightly-reboot
install -o root -g root -m 0644 "${SCRIPT_DIRECTORY}/homedash-nightly-reboot.service" /etc/systemd/system/homedash-nightly-reboot.service
install -o root -g root -m 0644 "${SCRIPT_DIRECTORY}/homedash-nightly-reboot.timer" /etc/systemd/system/homedash-nightly-reboot.timer
install -d -m 0755 /etc/systemd/journald.conf.d
install -o root -g root -m 0644 "${SCRIPT_DIRECTORY}/60-homedash-journal.conf" /etc/systemd/journald.conf.d/60-homedash-journal.conf
systemctl restart systemd-journald.service
journalctl --flush
systemctl daemon-reload
# Preserve an explicit disable on future automatic updates; enable only on first migration.
if [[ ! -e /var/lib/homedash/nightly-reboot-installed ]]; then
  systemctl enable --now homedash-nightly-reboot.timer
  touch /var/lib/homedash/nightly-reboot-installed
fi
if systemctl is-active --quiet homedash-nightly-reboot.timer; then
  systemctl restart homedash-nightly-reboot.timer
fi
echo "Protection de maintenance et timer de 03 h installés. Aucun redémarrage immédiat."
systemctl list-timers homedash-nightly-reboot.timer --no-pager
