# Document Encryption Production Activation

Fecha: 2026-08-30

Estado actual: `IMPLEMENTED_PENDING_PRODUCTION_E2E`

## Riesgo aceptado

La intervención se ejecutó como:

- `PRODUCTION_CHANGE_WITHOUT_VERIFIED_BACKUP`
- `risk_accepted = true`
- `scope = document_encryption_schema_only`
- `DISASTER_RECOVERY_BACKUP_PENDING`

Supabase no reportó un backup restaurable verificado (`backups=null`, PITR
deshabilitado). No se instaló Docker/WSL, no se usó `db push`, no se reparó el
historial de migraciones y no se modificó `supabase_migrations.schema_migrations`.

## Schema

- Proyecto: `kbjejiclhgjmiasauxyr`
- PostgreSQL: 17.6, `aarch64-unknown-linux-gnu`
- Precheck transaccional: `document_encryption_metadata = 0` filas
- SQL aplicado: `supabase/migrations/20260829232609_document_encryption_metadata.sql`
- SHA-256 aplicado: `AADB603C401A9371852FEED6152F735FB0E46F0621D148519740E3F1503FE519`
- Resultado de la transacción: PASS
- Snapshot: `docs/security/supabase-reconciliation/pre-encryption-schema-snapshot/`
- Rollback: `docs/security/supabase-reconciliation/ROLLBACK-DOCUMENT-ENCRYPTION-SCHEMA.sql`

La vista legacy dependiente se retiró antes de reemplazar la tabla vacía. También
se retiró `trg_sync_dek_counts` y se revocó ejecución pública de los helpers
`SECURITY DEFINER` relacionados con cifrado. El trigger de eventos de seguridad
quedó habilitado y bloquea UPDATE/DELETE.

## Metadata y acceso

Existen `document_encryption_metadata` y
`document_encryption_security_events`, ambas con RLS habilitado. No hay acceso de
`anon` ni `authenticated`; el backend usa `service_role`. La metadata contiene
tenant, documento, versión, artefacto, AES-256-GCM, wrapped DEK, nonce, auth tag,
AAD/hash, tamaños, hashes y referencias KMS. No contiene private keys, plaintext
DEK, KEK, credenciales ni bundles privados.

El bucket privado `documents` permite `application/octet-stream` para almacenar
ciphertext. Los objetos legacy no se modificaron.

## KMS y E2E

La CryptoKey simétrica HSM existente es:

`projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades-prod/cryptoKeys/docubox-document-kek`

La prueba real previa confirmó wrap/unwrap y AAD. La prueba productiva de
documento confirmó:

- PDF artificial de prueba: PASS
- ciphertext directo no inicia con `%PDF-`: PASS
- `ciphertext_sha256` coincide con metadata: PASS
- descarga autorizada y tenant/document/version AAD: PASS
- SHA-256 original = SHA-256 descargado: PASS
- ciphertext, nonce, AAD, wrapped DEK y recurso KMS alterados: FAIL cerrado
- resultado: `DOCUMENT ENCRYPTION PRODUCTION E2E VERIFIED`

El artefacto de prueba registró `plaintext_sha256=4f0721b2855d0ba9449d707e357a71b818155573a87bd0b3bb57f66627230175`
y `ciphertext_sha256=c2e0d99d577ddfcadbe6a2eae7d57d06ff2e603a0745dfde2df5c3323a00e6e0`.
No se imprimieron tokens, wrapped DEK ni credenciales.

## Deploy y smoke

- Deployment Vercel: `dpl_276SaupLKqmFDm16Q4QJdKQ75pkM`
- URL de deployment: `https://docubox-gpcnk8n25-docubox.vercel.app`
- Alias productivo: `https://docubox-delta.vercel.app`
- Resultado: `Ready`, target `production`, 2026-08-30
- `/login`: HTTP 200
- `/dashboard` y `/`: redirección autenticada
- listado de documentos y health interno sin credenciales: HTTP 401/405 según método,
  confirmando que no son públicos

El deployment no activa fallback a plaintext. La política productiva continúa
fallando cerrado si KMS, Storage o metadata no están disponibles.

## Regresión y advisories

- Encryption tests: 11/11 PASS
- Suite completa: 135/135 PASS
- TypeScript: PASS
- ESLint dirigido a los archivos de esta intervención: PASS
- Build: PASS, 213 páginas generadas
- Advisors: 0 WARN relacionados con cifrado; 2 INFO esperados por tablas
  backend-only sin policy de usuario

## Legacy

El inventario posterior de solo lectura mantiene 12 objetos plaintext, 1 objeto
corrupto y 0 cifrados. El objeto corrupto no se migró, corrigió, sobrescribió ni
eliminó. La migración canary de legacy queda pendiente hasta cerrar los E2E
posteriores y validar visor, descarga, auditoría y rollback operativo.

## Gates pendientes

Este acta no declara `PRODUCTION_VERIFIED` ni `FULLY_ENCRYPTED`. Siguen pendientes
los E2E productivos independientes de PAdES, TSA RFC 3161, NOM-151, constancias,
deployment y la migración progresiva de objetos plaintext elegibles. El motor
criptográfico, PAdES, TSA y NOM-151 no fueron modificados en esta activación.

## Estado del WP final

Los valores productivos de Vercel para PAdES, TSA, NOM-151 y WIF están presentes
como variables protegidas, pero no se extrajeron al workspace. En consecuencia,
los E2E encadenados que requieren esas credenciales se clasifican como
`BLOCKED`, no como PASS ni como FAIL del proveedor. La migración legacy queda
`NOT_RUN` hasta que esos gates se ejecuten desde el runtime operativo.
