#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 VERSION DOSSIER_SORTIE" >&2
  exit 1
fi

readonly VERSION_VALUE="$1"
OUTPUT_DIRECTORY="$2"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! "${VERSION_VALUE}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version SemVer invalide: ${VERSION_VALUE}" >&2
  exit 1
fi

for required_path in \
  "apps/server/dist/index.js" \
  "apps/web/dist/index.html" \
  "packages/contracts/dist/index.js"; do
  if [[ ! -f "${PROJECT_ROOT}/${required_path}" ]]; then
    echo "Build manquant: ${required_path}. Lancez npm run build auparavant." >&2
    exit 1
  fi
done

mkdir -p "${OUTPUT_DIRECTORY}"
OUTPUT_DIRECTORY="$(cd "${OUTPUT_DIRECTORY}" && pwd)"
readonly OUTPUT_DIRECTORY
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT
stage="${temporary_directory}/homedash-native"

mkdir -p "${stage}/apps/server" "${stage}/apps/web" "${stage}/packages/contracts"
cp "${PROJECT_ROOT}/package.json" "${PROJECT_ROOT}/package-lock.json" "${stage}/"
printf '%s\n' "${VERSION_VALUE}" > "${stage}/VERSION"
cp "${PROJECT_ROOT}/apps/server/package.json" "${stage}/apps/server/"
cp "${PROJECT_ROOT}/apps/web/package.json" "${stage}/apps/web/"
cp "${PROJECT_ROOT}/packages/contracts/package.json" "${stage}/packages/contracts/"
cp -R "${PROJECT_ROOT}/apps/server/dist" "${stage}/apps/server/"
cp -R "${PROJECT_ROOT}/apps/web/dist" "${stage}/apps/web/"
cp -R "${PROJECT_ROOT}/packages/contracts/dist" "${stage}/packages/contracts/"

archive="homedash-native-${VERSION_VALUE}.tar.gz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "${stage}" -cf - . | gzip -n > "${OUTPUT_DIRECTORY}/${archive}"
(
  cd "${OUTPUT_DIRECTORY}"
  sha256sum "${archive}" > "${archive}.sha256"
)

echo "Archive native créée: ${OUTPUT_DIRECTORY}/${archive}"
