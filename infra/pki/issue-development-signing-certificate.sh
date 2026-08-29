#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <signing.csr.pem> <signing.crt.pem>" >&2
  exit 64
fi

OPENSSL_BIN="${OPENSSL_BIN:-openssl}"
STATE_DIR="${DOCUBOX_PKI_STATE_DIR:-$HOME/.docubox-pki}"
CSR_PATH="$1"
CERT_PATH="$2"
CA_KEY="$STATE_DIR/root-ca.key.pem"
CA_CERT="$STATE_DIR/root-ca.crt.pem"
EXT_FILE="$(mktemp)"
trap 'rm -f "$EXT_FILE"' EXIT

if [ ! -r "$CA_KEY" ] || [ ! -r "$CA_CERT" ]; then
  echo "Missing development root CA. Run new-development-root-ca.sh first." >&2
  exit 1
fi

cat > "$EXT_FILE" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=codeSigning
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF

"$OPENSSL_BIN" req -in "$CSR_PATH" -noout -verify
"$OPENSSL_BIN" x509 -req -in "$CSR_PATH" -CA "$CA_CERT" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$CERT_PATH" -days 825 -sha256 -extfile "$EXT_FILE"

echo "Issued public signing certificate: $CERT_PATH"
