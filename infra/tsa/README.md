# Docubox Development RFC 3161 TSA

This service emits real RFC 3161 `TimeStampResp`/`TimeStampToken` artifacts for development only. It has a dedicated development Root CA and TSA signing key; neither is the Docubox document-signing key.

## Start

```bash
cd infra/tsa
TSA_INTERNAL_TOKEN="backend-only-secret" docker compose up --build
```

The first start creates its private material in the persistent Docker volume. It is never committed to Git. Export the public `root-ca.crt.pem` and `tsa.crt.pem` from the private volume to paths readable by the backend, then configure server-only variables:

```text
DOCUBOX_TSA_URL=http://127.0.0.1:8080/internal/tsa
DOCUBOX_TSA_INTERNAL_TOKEN=...
DOCUBOX_TSA_POLICY_OID=1.3.6.1.4.1.55555.1.1
DOCUBOX_TSA_CERTIFICATE_PATH=/private/path/tsa.crt.pem
DOCUBOX_TSA_TRUST_ROOT_PATH=/private/path/root-ca.crt.pem
DOCUBOX_TSA_TIMEOUT_MS=8000
```

Do not expose any of these values through `NEXT_PUBLIC_*`. The service uses the host/container UTC clock; production requires monitored NTP, drift alerts, a commercial or governed TSA, and independent operational controls.
