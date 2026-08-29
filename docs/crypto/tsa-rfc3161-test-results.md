# RFC 3161 TSA test results

Run:

```bash
npm run type-check
node --test tests/timestamp-provider.test.mjs tests/pades-provider.test.mjs
```

`timestamp-provider.test.mjs` creates a temporary Root CA and TSA certificate with `timeStamping` EKU, starts the internal TSA, and validates the token with both Docubox and OpenSSL. It covers a valid token plus altered data, nonce, policy, token and unavailable TSA cases.

`pades-provider.test.mjs` also signs a PDF, timestamps the CMS signature value with that live TSA, embeds the `signatureTimeStampToken` unsigned attribute, and independently re-verifies the resulting `PAdES-B-T` PDF through Docubox.

The full certification engine selects B-T only after its own PAdES verifier validates the embedded timestamp against the CMS signature value. When TSA configuration is absent, its documented rollback is B-B with `timestamp_status = not_configured`.
