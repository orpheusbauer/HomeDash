#!/usr/bin/env bash
set -euo pipefail

# Diagnostic en lecture seule. Il n'affiche ni homedash.env ni les jetons.

section() {
  printf '\n===== %s =====\n' "$1"
}

show_unit() {
  local unit="$1"
  local load_state
  load_state="$(systemctl show "${unit}" --property=LoadState --value 2>/dev/null || true)"
  if [[ -z "${load_state}" || "${load_state}" == "not-found" ]]; then
    printf '%s: unité absente\n' "${unit}"
    return
  fi

  section "${unit}"
  systemctl show "${unit}" --no-pager \
    --property=LoadState,ActiveState,SubState,FragmentPath,User,Group,WorkingDirectory,ExecStart,Restart,NRestarts,ExecMainCode,ExecMainStatus,Result,LimitCORE 2>&1 \
    || true
  systemctl status "${unit}" --no-pager -l 2>&1 || true
  journalctl -u "${unit}" -b -n 40 --no-pager 2>&1 || true
}

section "Système"
date --iso-8601=seconds
printf 'Architecture: %s, %s bits\n' "$(uname -m)" "$(getconf LONG_BIT)"
df -h /
df -i /
printf 'core_pattern: '
cat /proc/sys/kernel/core_pattern
printf 'core_uses_pid: '
cat /proc/sys/kernel/core_uses_pid

section "Core dumps présents directement sous /"
core_summary="$(find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) \
  -printf '%s\n' 2>/dev/null \
  | awk '{bytes += $1; count++} END {printf "%d %d", count, bytes}')"
read -r core_count core_bytes <<< "${core_summary:-0 0}"
printf 'Fichiers: %s\nOctets: %s\n' "${core_count:-0}" "${core_bytes:-0}"

latest_core="$(find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) \
  -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
if [[ -n "${latest_core}" ]]; then
  printf 'Dernier dump: %s\n' "${latest_core}"
  stat --printf='Date: %y\nTaille: %s octets\n' "${latest_core}" || true
  if command -v file >/dev/null 2>&1; then
    file "${latest_core}" || true
  fi
else
  echo "Aucun dump restant à analyser. Les états systemd ci-dessous restent exploitables."
fi

section "Services HomeDash"
show_unit homedash-updater.service
show_unit homedash.service

section "Processus Node.js et HomeDash"
ps -eo pid,ppid,user,lstart,stat,args --sort=pid \
  | grep -E '[n]ode|[h]omedash' || true

section "Binaires Node.js"
for node_path in /usr/bin/node /usr/local/bin/node /opt/node-v22.23.1-linux-armv6l/bin/node; do
  if [[ ! -e "${node_path}" ]]; then
    printf '%s: absent\n' "${node_path}"
    continue
  fi
  printf '\n%s -> %s\n' "${node_path}" "$(readlink -f "${node_path}")"
  if command -v file >/dev/null 2>&1; then
    file "${node_path}" || true
  fi
  # Une limite nulle garantit que ce test ne peut pas créer un nouveau core dump.
  (
    ulimit -c 0
    timeout 10 "${node_path}" --version
  ) 2>&1 || printf 'Échec de %s --version (code %s)\n' "${node_path}" "$?"
done

section "Unités en échec et services actifs pertinents"
systemctl --failed --no-pager 2>&1 || true
systemctl list-units --type=service --state=running --no-pager 2>&1 \
  | grep -Ei 'homedash|node|docker|nginx|UNIT' || true

cat <<'EOF'

Le rapport est terminé. Conservez sa sortie avant toute suppression d'unité ou de dump.
Il ne contient volontairement ni variables d'environnement, ni PIN, ni jeton GitHub.
EOF
