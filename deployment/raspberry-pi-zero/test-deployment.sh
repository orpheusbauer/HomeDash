#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for script in \
  install-native.sh \
  update-native.sh \
  install-node-armv6.sh \
  diagnose-crash-loop.sh \
  homedash-disk-guard; do
  bash -n "${SCRIPT_DIRECTORY}/${script}"
done

grep -Fxq 'WorkingDirectory=/opt/homedash/current' "${SCRIPT_DIRECTORY}/homedash-zero.service"
grep -Fxq 'LimitCORE=0' "${SCRIPT_DIRECTORY}/homedash-zero.service"
grep -Fxq 'StartLimitBurst=3' "${SCRIPT_DIRECTORY}/homedash-zero.service"
grep -Fxq 'Environment=HOMEDASH_UPDATER_SOCKET=/run/homedash-updater/updater.sock' "${SCRIPT_DIRECTORY}/homedash-zero.service"
grep -Fxq 'ExecStart=/usr/local/bin/node /usr/local/lib/homedash/native-updater-agent.mjs' "${SCRIPT_DIRECTORY}/homedash-native-updater.service"
node --check "${SCRIPT_DIRECTORY}/native-updater-agent.mjs"
grep -Fxq 'kernel.core_pattern=/dev/null' "${SCRIPT_DIRECTORY}/60-homedash-core-dumps.conf"

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT
mkdir -p "${temporary_directory}/bin"

cat > "${temporary_directory}/bin/df" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
percent="${MOCK_USAGE_PERCENT:?}"
if [[ "${1:-}" == "-Pi" ]]; then
  percent="${MOCK_INODE_PERCENT:-${percent}}"
fi
cat <<OUTPUT
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/mock 100 50 50 ${percent}% /
OUTPUT
EOF

cat > "${temporary_directory}/bin/logger" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${MOCK_LOG_FILE:?}"
EOF
chmod +x "${temporary_directory}/bin/df" "${temporary_directory}/bin/logger"

assert_level() {
  local percent="$1"
  local expected="$2"
  local state_file="${temporary_directory}/state-${percent}"
  local log_file="${temporary_directory}/log-${percent}"
  : > "${log_file}"
  PATH="${temporary_directory}/bin:${PATH}" \
    MOCK_USAGE_PERCENT="${percent}" \
    MOCK_INODE_PERCENT="${percent}" \
    MOCK_LOG_FILE="${log_file}" \
    HOMEDASH_DISK_GUARD_STATE_FILE="${state_file}" \
    bash "${SCRIPT_DIRECTORY}/homedash-disk-guard"
  grep -Fq "Niveau=${expected}" "${log_file}"
}

assert_level 79 ok
assert_level 80 warning
assert_level 90 error
assert_level 95 critical

echo "Raspberry Pi deployment tests passed."
