# WP-CRYPTO-09: E2E Certification UI Result

## Result

The existing `visor-documento` card remains the single UI for certification evidence. It now reads the backend-only `CRYPTO_CERTIFICATION_E2E_ENABLED` status and will not start a new certification while that flag is disabled.

The execution endpoint still requires an authenticated session and now rejects disabled environments with `CRYPTO_CERTIFICATION_E2E_DISABLED`. The flag defaults to `false` in `.env.example`; it must only be enabled after the environment has a working KeyManagementProvider, X.509 certificate provider, PAdES provider, TSA where B-T is requested, and the security migration is applied.

## Protected artifacts

The completed certification writes these immutable artifacts to the private `certification-artifacts` bucket:

| Artifact | Route | Access |
| --- | --- | --- |
| Verification report | `artifacts/verification-report` | Owner or workspace owner/admin |
| RFC 3161 token | `artifacts/timestamp-token` | Owner or workspace owner/admin |
| Signing certificate | `artifacts/signing-certificate` | Owner or workspace owner/admin |
| Certificate chain | `artifacts/certificate-chain` | Owner or workspace owner/admin |
| Evidence manifest | `artifacts/evidence-manifest` | Owner or workspace owner/admin |

The existing certificate PDF, package, and certified PDF routes now use the same owner-or-workspace-manager check. All downloads are proxied through Next.js with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`; no Storage signed URL is exposed in the browser location.

## Evidence truthfulness

The UI consumes persisted capability states. The engine only persists valid PAdES/certificate/timestamp statuses after `PdfSignatureProvider.verifyPdf()` succeeds. PAdES-B-T additionally requires a verified RFC 3161 timestamp token. A visual seal, a server timestamp, or a document creation date cannot enable these states.

## Verification

`tests/wp-crypto-09-e2e-ui.test.mjs` covers the backend execution gate, protected artifacts, role-based access boundary, and the presence of PAdES/RFC 3161 verification checks. The existing PAdES and timestamp suites continue to verify the actual cryptographic provider implementations.

## Deployment checklist

1. Apply the WP-07 Supabase hardening migration.
2. Configure the backend providers and their secrets outside frontend variables.
3. Set `CRYPTO_CERTIFICATION_E2E_ENABLED=true` only in the target backend environment.
4. Run the full test suite and one controlled certification in a non-production workspace.
