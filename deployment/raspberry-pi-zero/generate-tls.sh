#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 || "$#" -ne 2 ]]; then
  echo "Usage: sudo $0 NOM_HOTE ADRESSE_IPV4" >&2
  exit 1
fi

readonly HOMEDASH_HOSTNAME="$1"
readonly HOMEDASH_IP_ADDRESS="$2"
readonly CA_DIRECTORY="/var/lib/homedash/tls"
readonly TLS_DIRECTORY="/etc/homedash/tls"

if [[ ! "${HOMEDASH_HOSTNAME}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Nom d'hôte invalide: ${HOMEDASH_HOSTNAME}" >&2
  exit 1
fi
if [[ ! "${HOMEDASH_IP_ADDRESS}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Adresse IPv4 invalide: ${HOMEDASH_IP_ADDRESS}" >&2
  exit 1
fi

install -d -o root -g root -m 0755 "${CA_DIRECTORY}"
install -d -o root -g www-data -m 0750 "${TLS_DIRECTORY}"

if [[ ! -f "${CA_DIRECTORY}/root-ca.key" || ! -f "${CA_DIRECTORY}/root-ca.crt" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -keyout "${CA_DIRECTORY}/root-ca.key" \
    -out "${CA_DIRECTORY}/root-ca.crt" \
    -subj "/CN=HomeDash Local Root CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"
  chmod 0600 "${CA_DIRECTORY}/root-ca.key"
  chmod 0644 "${CA_DIRECTORY}/root-ca.crt"
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT

openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "${temporary_directory}/homedash.key" \
  -out "${temporary_directory}/homedash.csr" \
  -subj "/CN=${HOMEDASH_HOSTNAME}"

cat > "${temporary_directory}/server.ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:${HOMEDASH_HOSTNAME},IP:${HOMEDASH_IP_ADDRESS}
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

openssl x509 -req -sha256 -days 825 \
  -in "${temporary_directory}/homedash.csr" \
  -CA "${CA_DIRECTORY}/root-ca.crt" \
  -CAkey "${CA_DIRECTORY}/root-ca.key" \
  -CAcreateserial \
  -extfile "${temporary_directory}/server.ext" \
  -out "${temporary_directory}/homedash.crt"

install -o root -g www-data -m 0640 "${temporary_directory}/homedash.key" "${TLS_DIRECTORY}/homedash.key"
install -o root -g www-data -m 0644 "${temporary_directory}/homedash.crt" "${TLS_DIRECTORY}/homedash.crt"
openssl verify -CAfile "${CA_DIRECTORY}/root-ca.crt" "${TLS_DIRECTORY}/homedash.crt"

echo "Certificat créé pour ${HOMEDASH_HOSTNAME} et ${HOMEDASH_IP_ADDRESS}."
echo "CA publique à installer sur la tablette: ${CA_DIRECTORY}/root-ca.crt"
