#!/usr/bin/env bash
set -euo pipefail

readonly RELEASES_DIRECTORY="/opt/homedash/releases"
readonly CURRENT_LINK="/opt/homedash/current"
readonly DATA_DIRECTORY="/var/lib/homedash/data"
readonly BACKUP_DIRECTORY="${DATA_DIRECTORY}/backups"
readonly ENVIRONMENT_FILE="/etc/homedash/homedash.env"
readonly GITHUB_TOKEN_FILE="/etc/homedash/github-token"

if [[ "${EUID}" -ne 0 || "$#" -ne 1 ]]; then
  echo "Usage: sudo homedash-update-native vX.Y.Z" >&2
  exit 1
fi

readonly TAG="$1"
if [[ ! "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag invalide: ${TAG}. Format attendu: vX.Y.Z" >&2
  exit 1
fi
readonly VERSION_VALUE="${TAG#v}"
readonly ARCHIVE_NAME="homedash-native-${VERSION_VALUE}.tar.gz"
readonly CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"
readonly RELEASE_DIRECTORY="${RELEASES_DIRECTORY}/${VERSION_VALUE}"

if [[ ! -x /usr/local/bin/node || ! -x /usr/local/bin/npm ]]; then
  echo "Node.js ARMv6 n'est pas installé. Lancez install-node-armv6.sh." >&2
  exit 1
fi
if [[ ! -f "${ENVIRONMENT_FILE}" ]]; then
  echo "Configuration manquante: ${ENVIRONMENT_FILE}" >&2
  exit 1
fi

repository="$(sed -n 's/^HOMEDASH_GITHUB_REPOSITORY=//p' "${ENVIRONMENT_FILE}" | tail -n 1)"
if [[ ! "${repository}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "HOMEDASH_GITHUB_REPOSITORY est absent ou invalide." >&2
  exit 1
fi

auth_arguments=()
if [[ -s "${GITHUB_TOKEN_FILE}" ]]; then
  github_token="$(tr -d '\r\n' < "${GITHUB_TOKEN_FILE}")"
  auth_arguments=(-H "Authorization: Bearer ${github_token}")
fi

temporary_directory="$(mktemp -d)"
staged_release="${RELEASES_DIRECTORY}/.install-${VERSION_VALUE}-$$"
cleanup() {
  rm -rf -- "${temporary_directory}"
  if [[ -d "${staged_release}" ]]; then
    rm -rf -- "${staged_release}"
  fi
}
trap cleanup EXIT

download_release_asset() {
  local asset_name="$1"
  local destination="$2"
  local release_json asset_url

  release_json="$(curl --fail --silent --show-error --location --retry 4 \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "${auth_arguments[@]}" \
    "https://api.github.com/repos/${repository}/releases/tags/${TAG}")"
  asset_url="$(jq -r --arg name "${asset_name}" '.assets[] | select(.name == $name) | .url' <<< "${release_json}" | head -n 1)"
  if [[ -z "${asset_url}" || "${asset_url}" == "null" ]]; then
    echo "Asset ${asset_name} introuvable dans la release ${TAG}." >&2
    exit 1
  fi
  curl --fail --silent --show-error --location --retry 4 \
    -H 'Accept: application/octet-stream' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "${auth_arguments[@]}" \
    --output "${destination}" "${asset_url}"
}

if [[ ! -d "${RELEASE_DIRECTORY}" ]]; then
  echo "Téléchargement de HomeDash ${TAG} depuis GitHub Releases…"
  download_release_asset "${ARCHIVE_NAME}" "${temporary_directory}/${ARCHIVE_NAME}"
  download_release_asset "${CHECKSUM_NAME}" "${temporary_directory}/${CHECKSUM_NAME}"

  (
    cd "${temporary_directory}"
    sha256sum --check --strict "${CHECKSUM_NAME}"
  )

  if tar -tzf "${temporary_directory}/${ARCHIVE_NAME}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "L'archive contient un chemin non sûr; installation annulée." >&2
    exit 1
  fi

  install -d -o root -g homedash -m 0755 "${staged_release}"
  tar -xzf "${temporary_directory}/${ARCHIVE_NAME}" -C "${staged_release}"
  if [[ ! -f "${staged_release}/apps/server/dist/index.js" || ! -f "${staged_release}/apps/web/dist/index.html" ]]; then
    echo "Archive native incomplète; installation annulée." >&2
    exit 1
  fi

  echo "Installation des seules dépendances d'exécution (cela peut durer sur un Zero)…"
  (
    cd "${staged_release}"
    export NODE_OPTIONS="--max-old-space-size=192"
    export npm_config_jobs=1
    /usr/local/bin/npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace @homedash/server
  )
  chown -R root:homedash "${staged_release}"
  chmod -R u=rwX,g=rX,o=rX "${staged_release}"
  mv "${staged_release}" "${RELEASE_DIRECTORY}"
fi

install -d -o homedash -g homedash -m 0750 "${DATA_DIRECTORY}" "${BACKUP_DIRECTORY}"
previous_release=""
if [[ -L "${CURRENT_LINK}" ]]; then
  previous_release="$(readlink -f "${CURRENT_LINK}")"
fi
if [[ "${previous_release}" == "${RELEASE_DIRECTORY}" ]]; then
  systemctl restart homedash.service
  echo "HomeDash ${VERSION_VALUE} était déjà actif; service redémarré."
  exit 0
fi

systemctl stop homedash.service 2>/dev/null || true
backup_file="${BACKUP_DIRECTORY}/pre-${VERSION_VALUE}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar --exclude='./backups' -czf "${backup_file}" -C "${DATA_DIRECTORY}" .
chown homedash:homedash "${backup_file}"
chmod 0600 "${backup_file}"

next_link="/opt/homedash/.current-$$"
ln -s "${RELEASE_DIRECTORY}" "${next_link}"
mv -Tf "${next_link}" "${CURRENT_LINK}"
systemctl start homedash.service

healthy=false
for _attempt in $(seq 1 60); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4100/health/ready >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != "true" ]]; then
  echo "La nouvelle version n'est pas devenue saine; rollback automatique." >&2
  systemctl stop homedash.service 2>/dev/null || true
  rm -f -- "${DATA_DIRECTORY}/homedash.db" "${DATA_DIRECTORY}/homedash.db-shm" "${DATA_DIRECTORY}/homedash.db-wal"
  tar -xzf "${backup_file}" -C "${DATA_DIRECTORY}"
  chown -R homedash:homedash "${DATA_DIRECTORY}"
  if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
    rollback_link="/opt/homedash/.current-rollback-$$"
    ln -s "${previous_release}" "${rollback_link}"
    mv -Tf "${rollback_link}" "${CURRENT_LINK}"
    systemctl start homedash.service
  fi
  journalctl -u homedash.service -n 80 --no-pager >&2 || true
  exit 1
fi

printf '%s\n' "${VERSION_VALUE}" > /var/lib/homedash/installed-version
chown root:homedash /var/lib/homedash/installed-version
chmod 0644 /var/lib/homedash/installed-version
echo "HomeDash ${VERSION_VALUE} est actif. Sauvegarde préalable: ${backup_file}"
