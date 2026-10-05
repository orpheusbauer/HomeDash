#!/usr/bin/env bash
set -euo pipefail
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT
mkdir -p "${temporary_directory}/bin"
cat > "${temporary_directory}/bin/date" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${MOCK_HOUR:?}"
EOF
cat > "${temporary_directory}/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit "${MOCK_LOCK_RESULT:?}"
EOF
cat > "${temporary_directory}/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${MOCK_REBOOT_LOG:?}"
EOF
chmod +x "${temporary_directory}/bin/"*
# Only redirect the lock file into the test directory; never write /run or reboot the host.
sed "s|/run/homedash-maintenance.lock|${temporary_directory}/maintenance.lock|" \
  "${SCRIPT_DIRECTORY}/homedash-nightly-reboot" > "${temporary_directory}/reboot.sh"
for scenario in daytime busy night; do
  case "${scenario}" in
    daytime) hour=14; lock=0 ;;
    busy) hour=03; lock=1 ;;
    night) hour=03; lock=0 ;;
  esac
  log_file="${temporary_directory}/${scenario}.log"
  : > "${log_file}"
  PATH="${temporary_directory}/bin:${PATH}" MOCK_HOUR="${hour}" MOCK_LOCK_RESULT="${lock}" \
    MOCK_REBOOT_LOG="${log_file}" bash "${temporary_directory}/reboot.sh"
  if [[ "${scenario}" == night ]]; then
    grep -Fxq reboot "${log_file}"
  else
    test ! -s "${log_file}"
  fi
done
echo "Nightly reboot scheduling and maintenance protection passed."
