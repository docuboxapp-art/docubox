#!/usr/bin/env sh
set -eu

OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
STATE_DIR="${DOCUBOX_PKI_STATE_DIR:-$HOME/.docubox-pki}"
KEY_PATH="$STATE_DIR/root-ca.key.pem"
CERT_PATH="$STATE_DIR/root-ca.crt.pem"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR" 2>/dev/null || true

if [ -f "$KEY_PATH" ] || [ -f "$CERT_PATH" ]; then
  echo "A development root CA already exists at $STATE_DIR; refusing to overwrite it." >&2
  exit 1
fi

"$OPENSSL_BIN" req -x509 -newkey rsa:3072 -sha256 -nodes \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -days 3650 \
  -subj "/C=MX/O=Docubox/OU=Development Cryptographic Services/CN=Docubox Development Root CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash"

chmod 600 "$KEY_PATH" 2>/dev/null || true
echo "Development root certificate: $CERT_PATH"
echo "The CA private key remains outside this repository: $KEY_PATH"
