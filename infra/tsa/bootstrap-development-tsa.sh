#!/usr/bin/env bash
set -euo pipefail

# Generates a non-production TSA PKI. The private keys stay in data/, which is
# ignored by Git and must be mounted as a private persistent volume.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${TSA_DATA_DIR:-$SCRIPT_DIR/data}"
# Git Bash otherwise rewrites OpenSSL distinguished names such as /CN=... as
# Windows paths before OpenSSL sees them.
export MSYS_NO_PATHCONV=1
if command -v cygpath >/dev/null 2>&1; then
  SCRIPT_DIR="$(cygpath -w "$SCRIPT_DIR")"
  DATA_DIR="$(cygpath -w "$DATA_DIR")"
fi
mkdir -p "$DATA_DIR"

if [[ ! -f "$DATA_DIR/root-ca.crt.pem" ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
    -keyout "$DATA_DIR/root-ca.key.pem" \
    -out "$DATA_DIR/root-ca.crt.pem" \
    -subj "/CN=Docubox Development TSA Root CA/O=Docubox/OU=Development Cryptographic Services/C=MX"
fi

if [[ ! -f "$DATA_DIR/tsa.crt.pem" ]]; then
  openssl req -new -newkey rsa:2048 -nodes -sha256 \
    -keyout "$DATA_DIR/tsa.key.pem" \
    -out "$DATA_DIR/tsa.csr.pem" \
    -subj "/CN=Docubox Development TSA/O=Docubox/OU=Development Time Stamping/C=MX"
  openssl x509 -req -sha256 -days 825 \
    -in "$DATA_DIR/tsa.csr.pem" \
    -CA "$DATA_DIR/root-ca.crt.pem" \
    -CAkey "$DATA_DIR/root-ca.key.pem" \
    -CAcreateserial \
    -out "$DATA_DIR/tsa.crt.pem" \
    -extfile "$SCRIPT_DIR/tsa-certificate.ext" -extensions tsa_certificate
  rm -f "$DATA_DIR/tsa.csr.pem"
fi

cat "$DATA_DIR/root-ca.crt.pem" > "$DATA_DIR/tsa-chain.pem"
[[ -f "$DATA_DIR/tsaserial" ]] || printf '01\n' > "$DATA_DIR/tsaserial"
printf 'Development TSA ready. Public trust root: %s\n' "$DATA_DIR/root-ca.crt.pem"
