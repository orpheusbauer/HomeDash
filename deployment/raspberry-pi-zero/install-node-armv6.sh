#!/usr/bin/env bash
set -euo pipefail

readonly NODE_VERSION="22.23.1"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-armv6l.tar.xz"
readonly NODE_SHA256="bcdfed6c00d6021f75bd0bd0d26270a59cefc0d820fdf7e4d6ee2dea20d550c2"
readonly NODE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_VERSION}/${NODE_ARCHIVE}"
readonly NODE_PREFIX="/opt/node-v${NODE_VERSION}-linux-armv6l"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Exécutez ce script avec sudo." >&2
  exit 1
fi

if [[ "$(uname -m)" != "armv6l" ]]; then
  echo "Architecture attendue: armv6l; architecture détectée: $(uname -m)." >&2
  echo "Ce script est réservé au Raspberry Pi Zero/Zero W original." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl xz-utils

if [[ ! -x "${NODE_PREFIX}/bin/node" ]]; then
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf -- "${temporary_directory}"' EXIT

  echo "Téléchargement de Node.js v${NODE_VERSION} pour ARMv6…"
  curl --fail --location --retry 4 --retry-delay 3 \
    --output "${temporary_directory}/${NODE_ARCHIVE}" "${NODE_URL}"

  echo "${NODE_SHA256}  ${temporary_directory}/${NODE_ARCHIVE}" | sha256sum --check --strict
  tar -xJf "${temporary_directory}/${NODE_ARCHIVE}" -C /opt
fi

for executable in node npm npx corepack; do
  ln -sfn "${NODE_PREFIX}/bin/${executable}" "/usr/local/bin/${executable}"
done

/usr/local/bin/node --version
/usr/local/bin/npm --version
/usr/local/bin/node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('SELECT 1'); db.close();"

echo "Node.js ARMv6 et node:sqlite sont opérationnels."
