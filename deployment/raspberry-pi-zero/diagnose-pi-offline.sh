#!/usr/bin/env bash
set -uo pipefail

# Observation uniquement : ne redémarre rien, ne lit pas les fichiers de secrets.
# Le rapport peut contenir des adresses, SSID et messages de journaux à relire.
export LC_ALL=C SYSTEMD_COLORS=0 SYSTEMD_PAGER=cat

if [[ "$#" -ne 0 || "${EUID}" -ne 0 ]]; then
  echo "Usage, sur le Raspberry Pi : sudo bash $0" >&2
  exit 1
fi
if [[ "$(uname -s)" != Linux ]]; then
  echo "Ce diagnostic doit être exécuté sur le Raspberry Pi sous Linux." >&2
  exit 1
fi

section() {
  printf '\n===== %s =====\n' "$1"
}

run() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Outil absent : %s\n' "$1"
    return 0
  fi
  timeout --kill-after=2s 15s "$@" 2>&1 || true
}

show_unit() {
  local unit="$1" control_group directory item
  section "${unit}"
  run systemctl show "${unit}" --no-pager \
    --property=LoadState,ActiveState,SubState,FragmentPath,MainPID,NRestarts,Result,ExecMainCode,ExecMainStatus,MemoryAccounting,MemoryCurrent,MemoryPeak,MemoryHigh,MemoryMax,MemorySwapMax,ControlGroup
  control_group="$(systemctl show "${unit}" -p ControlGroup --value 2>/dev/null || true)"
  if [[ -z "${control_group}" || "${control_group}" != /* || "${control_group}" == *..* ]]; then
    return
  fi
  # Lire les limites du noyau : une valeur dans l'unité seule ne prouve pas
  # que le contrôleur mémoire est disponible et applique cette limite.
  for directory in "/sys/fs/cgroup${control_group}" "/sys/fs/cgroup/memory${control_group}"; do
    for item in memory.current memory.high memory.max memory.events memory.swap.current memory.swap.max \
      memory.usage_in_bytes memory.limit_in_bytes memory.failcnt memory.oom_control; do
      if [[ -r "${directory}/${item}" ]]; then
        printf '%s:\n' "${directory}/${item}"
        cat "${directory}/${item}"
      fi
    done
  done
}

section 'Date, matériel et système'
date --iso-8601=seconds
if [[ -r /proc/device-tree/model ]]; then
  tr -d '\0' < /proc/device-tree/model
  printf '\n'
fi
uname -a
getconf LONG_BIT
cat /etc/os-release
uptime
printf 'Version HomeDash : '
if [[ -r /var/lib/homedash/installed-version ]]; then
  cat /var/lib/homedash/installed-version
else
  printf 'fichier absent\n'
fi
run vcgencmd measure_temp
run vcgencmd get_throttled
echo 'Attention : la gamme Pi Zero ne possède pas de détection de sous-tension ; 0x0 ne valide pas son alimentation.'

section 'Mémoire, swap, pression et processus'
run free -h
run swapon --show
for item in /proc/pressure/memory /proc/pressure/io /sys/fs/cgroup/cgroup.controllers \
  /sys/fs/cgroup/cgroup.subtree_control; do
  if [[ -r "${item}" ]]; then
    printf '%s:\n' "${item}"
    cat "${item}"
  fi
done
if [[ ! -e /sys/fs/cgroup/cgroup.controllers && -r /proc/cgroups ]]; then
  printf '/proc/cgroups (contrôleurs v1) :\n'
  cat /proc/cgroups
fi
ps -eo pid,ppid,comm,rss,%mem,%cpu,stat --sort=-rss | head -n 13 || true
run vmstat 1 3

section 'Stockage et anciens core dumps'
run df -h / /var/log
run df -i /
find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) -printf '%s\n' 2>/dev/null \
  | awk '{count++; bytes += $1} END {printf "Core dumps sous / : %d fichiers, %.0f octets\n", count, bytes}'
if [[ -r /proc/sys/kernel/core_pattern ]]; then
  printf 'core_pattern : '
  cat /proc/sys/kernel/core_pattern
fi

section 'Réseau actuel'
run ip -br address
run ip -4 route
run rfkill list
for wifi_path in /sys/class/net/*/wireless; do
  [[ -d "${wifi_path}" ]] || continue
  interface="${wifi_path%/wireless}"
  interface="${interface##*/}"
  printf '\nInterface Wi-Fi : %s\n' "${interface}"
  run iw dev "${interface}" link
  run iw dev "${interface}" get power_save
  if command -v nmcli >/dev/null 2>&1; then
    connection_uuid="$(timeout 5s nmcli -g GENERAL.CON-UUID device show "${interface}" 2>/dev/null || true)"
    if [[ "${connection_uuid}" =~ ^[[:xdigit:]-]{36}$ ]]; then
      run nmcli -f connection.id,connection.uuid,connection.autoconnect,connection.autoconnect-retries,802-11-wireless.powersave \
        connection show uuid "${connection_uuid}"
    fi
  fi
done
run nmcli device status
gateway="$(ip -4 route show default 2>/dev/null | awk '/via/ {for (i=1; i<NF; i++) if ($i == "via") {print $(i+1); exit}}')"
if [[ -n "${gateway}" ]]; then
  printf 'Test de la passerelle locale : %s\n' "${gateway}"
  run ping -n -c 2 -W 2 "${gateway}"
fi

section 'Santé du serveur sur le Pi'
run curl --silent --show-error --max-time 5 --output /dev/null \
  --write-out 'HomeDash local : HTTP %{http_code}, %{time_total}s\n' \
  http://127.0.0.1:4100/health/ready
for unit in homedash.service homedash-native-updater.service homedash-updater.service \
  nginx.service ssh.service NetworkManager.service dhcpcd.service; do
  show_unit "${unit}"
done
run systemctl --failed --no-pager

section 'Conservation des journaux'
run journalctl --disk-usage
boot_list="$(timeout 15s journalctl --list-boots --no-pager 2>&1 || true)"
printf '%s\n' "${boot_list}"
if [[ -d /var/log/journal ]]; then
  echo '/var/log/journal existe ; la liste des démarrages indique ce qui a réellement été conservé.'
else
  echo '/var/log/journal absent : voir le guide pour conserver les traces de la prochaine panne.'
fi
if command -v systemd-analyze >/dev/null 2>&1; then
  timeout 10s systemd-analyze cat-config systemd/journald.conf 2>/dev/null \
    | grep -E '^(# /|Storage=|SystemMaxUse=|SystemKeepFree=|RuntimeMaxUse=|MaxRetentionSec=|SyncIntervalSec=)' || true
fi

for boot in 0 -1; do
  if [[ "${boot}" == -1 ]] && ! grep -Eq '^[[:space:]]*-1[[:space:]]' <<< "${boot_list}"; then
    section 'Démarrage précédent indisponible'
    echo 'Les traces perdues au redémarrage ne peuvent pas être récupérées par ce script.'
    continue
  fi
  section "Noyau : démarrage ${boot}, 120 dernières lignes"
  run journalctl -b "${boot}" -k -n 120 --no-pager -o short-iso
  section "Réseau : démarrage ${boot}, 100 dernières lignes"
  run journalctl -b "${boot}" -u NetworkManager -u wpa_supplicant -u dhcpcd \
    -n 100 --no-pager -o short-iso
  section "HomeDash : démarrage ${boot}, avertissements/erreurs"
  run journalctl -b "${boot}" -u homedash -u homedash-native-updater -u homedash-updater \
    -p warning -n 60 --no-pager -o short-iso
  section "Mises à jour et disque : démarrage ${boot}"
  run journalctl -b "${boot}" -u homedash-native-updater -u homedash-disk-guard \
    -n 40 --no-pager -o short-iso
  section "Collecte mémoire temporaire : démarrage ${boot}, 60 dernières lignes"
  run journalctl -b "${boot}" -u homedash-memory-diagnostic \
    -n 60 --no-pager -o short-iso
done

printf '\nDiagnostic terminé. Aucun service ni paramètre n’a été modifié.\n'
