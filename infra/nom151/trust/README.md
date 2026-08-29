# NOM-151 PSC trust bundle

This directory contains public trust material only. It does not contain Nubarium
credentials or private keys.

The active bundle pins the official ACR2-SE root published by the Secretaria de
Economia. Runtime issuance never downloads or automatically trusts certificates
from the provider response. Trust changes require the explicit onboarding script,
fingerprint review and a manifest version update.

Required backend configuration:

```text
NOM151_ENVIRONMENT=development|sandbox|production
NOM151_PSC_TRUST_MANIFEST_PATH=infra/nom151/trust/manifest.json
NOM151_PSC_TRUST_ROOT_PATH=infra/nom151/trust/roots/ACR2_SE.pem
NOM151_PSC_TRUST_ROOT_SHA256=b2f258c42c3066c54c3d9bbcb9a4c16bed4e7b74f302643a11af26961e09c720
NOM151_PSC_TRUST_BUNDLE_VERSION=1
```

Production additionally requires `NOM151_PRODUCTION_ENDPOINT` to exactly match
`NOM151_NUBARIUM_ENDPOINT` and contractual confirmation that the credentials and
endpoint correspond to production.
