#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 || "$#" -ne 1 ]]; then
  echo "Usage: sudo $0 vX.Y.Z" >&2
  exit 1
fi

readonly TAG="$1"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DEPLOYMENT_DIRECTORY="${PROJECT_ROOT}/deployment/raspberry-pi-zero"

detect_github_repository() {
  local repository="${HOMEDASH_GITHUB_REPOSITORY:-}"
  local origin=""
  if [[ -z "${repository}" ]]; then
    origin="$(git -C "${PROJECT_ROOT}" remote get-url origin 2>/dev/null || true)"
    case "${origin}" in
      https://github.com/*) repository="${origin#https://github.com/}" ;;
      ssh://git@github.com/*) repository="${origin#ssh://git@github.com/}" ;;
      git@*:*) repository="${origin#*:}" ;;
    esac
    repository="${repository%.git}"
  fi
  if [[ ! "${repository}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "Impossible de déduire le dépôt GitHub depuis le remote origin." >&2
    echo "Relancez avec HOMEDASH_GITHUB_REPOSITORY=proprietaire/depot sudo -E $0 ${TAG}." >&2
    exit 1
  fi
  printf '%s' "${repository}"
}

# Aucun programme lancé par l'installeur ne doit pouvoir remplir la carte SD en
# cas de défaut natif. La politique persistante est installée plus bas.
ulimit -c 0 || true

if [[ "$(uname -m)" != "armv6l" || "$(getconf LONG_BIT)" != "32" ]]; then
  echo "Cette installation exige un Raspberry Pi Zero/Zero W original, armv6l 32 bits." >&2
  echo "Détecté: $(uname -m), $(getconf LONG_BIT) bits." >&2
  exit 1
fi
if [[ ! "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag invalide: ${TAG}. Format attendu: vX.Y.Z" >&2
  exit 1
fi

# Les versions Docker installaient un agent séparé qui utilisait /usr/bin/node,
# n'avait pas de WorkingDirectory et redémarrait toutes les cinq secondes. Il
# n'a aucun rôle dans le déploiement ARMv6 natif et doit être retiré avant toute
# autre opération pour arrêter une éventuelle boucle de crash.
legacy_updater_found=false
if systemctl cat homedash-updater.service >/dev/null 2>&1 \
  || [[ -e /etc/systemd/system/homedash-updater.service ]]; then
  legacy_updater_found=true
  systemctl disable --now homedash-updater.service 2>/dev/null || true
  rm -f -- /etc/systemd/system/homedash-updater.service
fi

apt-get update
apt-get install -y ca-certificates curl file git jq nginx openssl procps xz-utils

bash "${DEPLOYMENT_DIRECTORY}/install-node-armv6.sh"

getent group homedash >/dev/null || groupadd --system homedash
id homedash >/dev/null 2>&1 || useradd --system --gid homedash \
  --home-dir /var/lib/homedash --shell /usr/sbin/nologin homedash

install -d -o root -g root -m 0755 /opt/homedash /opt/homedash/releases
install -d -o homedash -g homedash -m 0750 /var/lib/homedash /var/lib/homedash/data /var/lib/homedash/data/backups /var/lib/homedash/data/android-updates
install -d -o root -g homedash -m 0750 /etc/homedash
install -d -o root -g root -m 0755 /usr/local/lib/homedash
install -d -o root -g root -m 0755 /etc/sysctl.d /etc/systemd/journald.conf.d

if [[ ! -s /etc/homedash/updater-token ]]; then
  openssl rand -hex 32 | tr -d '\n' > /etc/homedash/updater-token
fi
chown root:homedash /etc/homedash/updater-token
chmod 0640 /etc/homedash/updater-token
printf 'HOMEDASH_GROUP_ID=%s\n' "$(getent group homedash | cut -d: -f3)" \
  > /etc/homedash/native-updater.env
chown root:homedash /etc/homedash/native-updater.env
chmod 0640 /etc/homedash/native-updater.env

install -o root -g root -m 0755 "${DEPLOYMENT_DIRECTORY}/update-native.sh" /usr/local/sbin/homedash-update-native
install -o root -g root -m 0755 "${DEPLOYMENT_DIRECTORY}/native-updater-agent.mjs" /usr/local/lib/homedash/native-updater-agent.mjs
install -o root -g root -m 0755 "${DEPLOYMENT_DIRECTORY}/homedash-disk-guard" /usr/local/sbin/homedash-disk-guard
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/homedash-zero.service" /etc/systemd/system/homedash.service
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/homedash-native-updater.service" /etc/systemd/system/homedash-native-updater.service
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/homedash-disk-guard.service" /etc/systemd/system/homedash-disk-guard.service
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/homedash-disk-guard.timer" /etc/systemd/system/homedash-disk-guard.timer
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/60-homedash-core-dumps.conf" /etc/sysctl.d/60-homedash-core-dumps.conf
install -o root -g root -m 0644 "${DEPLOYMENT_DIRECTORY}/60-homedash-journal.conf" /etc/systemd/journald.conf.d/60-homedash-journal.conf
sysctl --load /etc/sysctl.d/60-homedash-core-dumps.conf >/dev/null

ip_address="${HOMEDASH_IP_ADDRESS:-$(ip -4 route get 1.1.1.1 | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')}"
host_name="${HOMEDASH_HOSTNAME:-$(hostname).local}"
if [[ ! "${host_name}" =~ ^[A-Za-z0-9.-]+$ || ! "${ip_address}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Impossible de déterminer un nom d'hôte ou une IPv4 valides." >&2
  echo "Relancez avec HOMEDASH_HOSTNAME=homedash.local HOMEDASH_IP_ADDRESS=IP_DU_PI sudo -E …" >&2
  exit 1
fi

if [[ ! -f /etc/homedash/homedash.env ]]; then
  github_repository="$(detect_github_repository)"
  sensor_token="$(openssl rand -hex 32)"
  encryption_key="$(openssl rand -hex 32)"
  cat > /etc/homedash/homedash.env <<EOF
NODE_ENV=production
HOMEDASH_HOST=127.0.0.1
HOMEDASH_PORT=4100
HOMEDASH_DATABASE_PATH=/var/lib/homedash/data/homedash.db
HOMEDASH_PUBLIC_URL=https://${ip_address}
HOMEDASH_TIMEZONE=Europe/Paris
HOMEDASH_ADMIN_PIN=0000
HOMEDASH_SENSOR_INGEST_TOKEN=${sensor_token}
HOMEDASH_ENCRYPTION_KEY=${encryption_key}
HOMEDASH_GITHUB_REPOSITORY=${github_repository}
HOMEDASH_GITHUB_TOKEN_FILE=/etc/homedash/github-token
HOMEDASH_ANDROID_UPDATE_CACHE=/var/lib/homedash/data/android-updates
HOMEDASH_SYSTEM_METRICS_INTERVAL_MS=30000
HOMEDASH_ENABLE_MOCK_SENSORS=false
EOF
fi

# Migration des premières installations, application du PIN demandé et cache
# APK dans un répertoire persistant accessible à l'utilisateur homedash.
sed -i \
  -e '/^HOMEDASH_ADMIN_TOKEN=/d' \
  -e '/^HOMEDASH_ADMIN_PIN=/d' \
  -e '/^HOMEDASH_ANDROID_UPDATE_CACHE=/d' \
  /etc/homedash/homedash.env
printf '\nHOMEDASH_ADMIN_PIN=0000\nHOMEDASH_ANDROID_UPDATE_CACHE=/var/lib/homedash/data/android-updates\n' \
  >> /etc/homedash/homedash.env
chown root:homedash /etc/homedash/homedash.env
chmod 0640 /etc/homedash/homedash.env

if [[ -f /etc/homedash/github-token ]]; then
  chown root:homedash /etc/homedash/github-token
  chmod 0640 /etc/homedash/github-token
fi

bash "${DEPLOYMENT_DIRECTORY}/generate-tls.sh" "${host_name}" "${ip_address}"
sed \
  -e "s/__HOMEDASH_HOSTNAME__/${host_name}/g" \
  -e "s/__HOMEDASH_IP_ADDRESS__/${ip_address}/g" \
  "${DEPLOYMENT_DIRECTORY}/nginx-homedash.conf" > /etc/nginx/sites-available/homedash
ln -sfn /etc/nginx/sites-available/homedash /etc/nginx/sites-enabled/homedash
if [[ -e /etc/nginx/sites-enabled/default && ! -e /etc/nginx/sites-enabled/default.disabled-by-homedash ]]; then
  mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.disabled-by-homedash
fi
nginx -t

systemctl daemon-reload
systemctl reset-failed homedash.service 2>/dev/null || true
systemctl enable nginx.service homedash.service homedash-native-updater.service homedash-disk-guard.timer
systemctl restart systemd-journald.service
systemctl start homedash-disk-guard.service
systemctl start homedash-disk-guard.timer
systemctl restart homedash-native-updater.service
systemctl restart nginx.service
/usr/local/sbin/homedash-update-native "${TAG}"

echo
echo "Installation terminée."
echo "Interface: https://${ip_address} ou https://${host_name}"
echo "CA à copier sur la tablette: /var/lib/homedash/tls/root-ca.crt"
echo "Diagnostic: sudo systemctl status homedash nginx --no-pager"
echo "Surveillance disque: sudo systemctl status homedash-disk-guard.timer --no-pager"
echo "Mises à jour intégrées: sudo systemctl status homedash-native-updater --no-pager"
if [[ "${legacy_updater_found}" == "true" ]]; then
  echo "Ancien service Docker homedash-updater désactivé et retiré."
fi

root_core_count="$(find / -maxdepth 1 -type f \( -name core -o -name 'core.*' \) \
  -printf '.' 2>/dev/null | wc -c)"
if (( root_core_count > 0 )); then
  echo "ATTENTION: ${root_core_count} ancien(s) core dump(s) subsistent sous /."
  echo "Analysez-en au plus un, puis supprimez uniquement /core et /core.* après vérification."
fi
