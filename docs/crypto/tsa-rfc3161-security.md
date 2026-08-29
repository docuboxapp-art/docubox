# RFC 3161 TSA security notes

- TSA and document-signing keys are distinct. The TSA private key is generated only in ignored local data or a private persistent volume.
- The TSA endpoint is intended for backend-to-backend access. `TSA_INTERNAL_TOKEN` is required outside a controlled local test and is never sent to the browser.
- Private `.key`, `.p12` and `.pfx` files are ignored globally. Public certificates are validated by fingerprint and chain, not trusted merely because an endpoint returned them.
- The provider fails closed on malformed DER, a rejected response, missing token, invalid CMS, invalid chain, non-timeStamping EKU, mismatched imprint/nonce/policy, expiration, timeout or unavailable service.
- Timestamp artifacts use the existing private certification artifact bucket and inherit tenant authorization/RLS through certification access. The request, response and token are not public URLs.
- This internal TSA is explicitly development-only. It does not establish production trust, revocation checking, PAdES-LT/LTA, a commercial TSA SLA, or NOM-151.
