#!/usr/bin/env bash
set -euo pipefail

# Runs the actual npm block from update-native.sh, without root, GitHub or any
# production paths. Also run this test in a transient ProtectHome service in CI.
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT
staged_release="${temporary_directory}/release"
mkdir -p "${staged_release}/apps/server" "${temporary_directory}/fixture/package"
printf '%s\n' '{"name":"test-dependency","version":"1.0.0"}' \
  > "${temporary_directory}/fixture/package/package.json"
tar -czf "${staged_release}/fixture.tgz" -C "${temporary_directory}/fixture" package
printf '%s\n' '{"name":"test-root","version":"1.0.0","workspaces":["apps/*"]}' \
  > "${staged_release}/package.json"
printf '%s\n' '{"name":"@homedash/server","version":"1.0.0","dependencies":{"test-dependency":"file:../../fixture.tgz"}}' \
  > "${staged_release}/apps/server/package.json"
printf '%s\n' '{"name":"test-root","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"test-root","version":"1.0.0","workspaces":["apps/*"]},"apps/server":{"name":"@homedash/server","version":"1.0.0","dependencies":{"test-dependency":"file:../../fixture.tgz"}},"node_modules/@homedash/server":{"resolved":"apps/server","link":true},"node_modules/test-dependency":{"version":"1.0.0","resolved":"file:fixture.tgz"}}}' \
  > "${staged_release}/package-lock.json"

# Extract the whole production subshell so a regression in its cache argument
# fails here too. Only the fixed npm executable is mapped to the test runtime.
awk '/^    cd "\$\{staged_release\}"$/ { copying=1 }
     copying && /^  \)$/ { exit }
     copying { print }' "${SCRIPT_DIRECTORY}/update-native.sh" \
  | sed 's|/usr/local/bin/npm ci|npm ci|' > "${temporary_directory}/install-block.sh"
test -s "${temporary_directory}/install-block.sh"

if [[ "${1:-}" == "--protected-home" ]]; then
  # Negative control under real systemd isolation: the pre-fix command must
  # reproduce the reported /root/.npm failure, then the fixed command must pass.
  test "${EUID}" -eq 0
  test ! -r /root/.profile
  test "$(npm config get cache)" = /root/.npm
  sed '/--cache .*--userconfig /d' "${temporary_directory}/install-block.sh" \
    > "${temporary_directory}/original-block.sh"
  if (source "${temporary_directory}/original-block.sh") > "${temporary_directory}/original.log" 2>&1; then
    echo 'Expected the original npm command to fail with ProtectHome=true.' >&2
    exit 1
  fi
  grep -E 'npm (error|ERR!).*/root/\.npm' "${temporary_directory}/original.log"
fi

# A file cannot hold a cache: if the explicit CLI cache is lost, npm must fail,
# even on developer machines where the default home directory is writable.
printf '%s\n' 'not a directory' > "${temporary_directory}/inaccessible-cache"
export npm_config_cache="${temporary_directory}/inaccessible-cache"
(
  source "${temporary_directory}/install-block.sh"
)
test -d "${temporary_directory}/npm-cache/_logs"
test -d "${staged_release}/node_modules/@homedash/server"
test -f "${staged_release}/node_modules/test-dependency/package.json"
echo "Native updater npm cache isolation passed."
