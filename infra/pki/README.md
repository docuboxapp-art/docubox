# Development PKI

This directory contains scripts, not certificate authority material. The development
CA private key is created outside the repository in `DOCUBOX_PKI_STATE_DIR` (default:
`$HOME/.docubox-pki`). Do not copy that directory into Git, Supabase Storage, or a
frontend build.

## Create the local root CA

```sh
DOCUBOX_PKI_STATE_DIR="$HOME/.docubox-pki" ./infra/pki/new-development-root-ca.sh
```

On Windows with Git for Windows, set `OPENSSL_BIN` to the installed OpenSSL binary,
for example `C:/Program Files/Git/usr/bin/openssl.exe`.

The command creates `root-ca.key.pem` and `root-ca.crt.pem` only in the external
state directory. The root certificate is public; the key is not.

## Issue a certificate for the managed signing key

The application creates a PKCS#10 CSR by asking `KeyManagementProvider.signDigest()`
to sign the CertificationRequestInfo. The managed signing private key never leaves
OpenBao/KMS.

```sh
./infra/pki/issue-development-signing-certificate.sh /secure/path/signing.csr.pem /secure/path/signing.crt.pem
```

Configure the backend with public material only:

```text
DOCUBOX_CRYPTO_ENVIRONMENT=DEVELOPMENT
DOCUBOX_SIGNING_CERTIFICATE_PATH=/secure/path/signing.crt.pem
DOCUBOX_DEVELOPMENT_ROOT_CERTIFICATE_PATH=$HOME/.docubox-pki/root-ca.crt.pem
DOCUBOX_SIGNING_CERTIFICATE_KEY_ID=docubox-development-signing
```

`certificate_status` must never be represented as valid when the certificate is
expired, not yet valid, has an invalid chain, or its public key differs from the
managed signing key.
