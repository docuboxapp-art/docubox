# WP-CRYPTO-06: RFC 3161 TSA implementation

## Scope completed

Docubox now has a server-side `TimestampAuthorityProvider` with a `LocalRfc3161Provider`. It generates a DER `TimeStampReq`, sends it to the internal development TSA, parses the DER `TimeStampResp` and `TimeStampToken`, and verifies:

- SHA-256 message imprint and algorithm;
- nonce, policy OID, TSA serial number and `genTime`;
- CMS signature of the token;
- TSA certificate fingerprint, validity, EKU `timeStamping` and chain to the configured development root.

The PAdES provider applies the token as the CMS unsigned `signatureTimeStampToken` attribute. It only returns `PAdES-B-T` after that PDF verifies again, including the timestamp. Without the TSA configuration, it deliberately remains on `PAdES-B-B` and reports `timestamp_status = not_configured`.

## Development infrastructure

`infra/tsa/` contains a local OpenSSL-backed TSA service, a dedicated development Root CA and a separate TSA certificate with `extendedKeyUsage=timeStamping`. The bootstrap process writes all private material and serial state to ignored `infra/tsa/data/` or a mounted Docker volume.

The document-signing key remains in `KeyManagementProvider`; it is never exported to issue TSA tokens.

## Persisted evidence

The existing `timestamp_records` table is reused. The engine writes its hash, policy, nonce, serial, `gen_time`, TSA certificate metadata and private Storage paths for:

- `request.tsq`;
- `response.tsr`;
- `token.tst`.

The technical package includes the same artifacts and verification report. `document_pdf_signatures.timestamp_record_id` links the PAdES evidence to the verified RFC 3161 record.

## Operational configuration

All variables are server-only:

```text
DOCUBOX_TSA_URL=http://127.0.0.1:8080/internal/tsa
DOCUBOX_TSA_INTERNAL_TOKEN=<backend-only secret>
DOCUBOX_TSA_POLICY_OID=1.3.6.1.4.1.55555.1.1
DOCUBOX_TSA_CERTIFICATE_PATH=/private/path/tsa.crt.pem
DOCUBOX_TSA_TRUST_ROOT_PATH=/private/path/root-ca.crt.pem
DOCUBOX_TSA_TIMEOUT_MS=8000
```

Never put these values in `NEXT_PUBLIC_*`. The development service uses UTC from its host. Production needs NTP monitoring, drift alerts and an approved external or governed TSA.

## Boundaries

NOM-151 remains separate. An RFC 3161 token is not a NOM-151 constancia and no user-facing state may conflate them.
