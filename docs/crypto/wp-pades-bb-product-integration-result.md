# WP-PADES-BB-PRODUCT-INTEGRATION

## Resultado

**REAL DOCUMENT PADES-B-B VERIFIED**

La integración reutiliza el motor PAdES-B-B, `KeyManagementProvider`, Google Cloud KMS,
`CertificateProvider` y los verificadores existentes. No incorpora TSA, PAdES-B-T, NOM-151
ni HSM.

## Punto de integración

El punto productivo es `POST /api/documentos/{documentId}/seal-signatures`, después de que
`createSignedDocumentPdf()` termina el PDF visual y antes de publicar el PDF definitivo en
`documentos.sealed_pdf_path`.

Flujo aplicado:

```text
firmas de participantes completadas
  -> PDF visual final con metadatos y estampas
  -> versión documental inmutable
  -> CertificationOrchestrator
  -> PAdES-B-B / Google KMS / CMS / X.509
  -> verificación primaria
  -> verificación independiente
  -> persistencia técnica COMPLETED
  -> promoción del PDF verificado
  -> actualización de documentos.sealed_pdf_path
```

## Comportamiento fail-closed

El PDF visual se conserva antes de PAdES. El PDF promovido no sustituye la referencia final
hasta que se cumplan todas estas condiciones persistidas:

- `ByteRange valid = true`
- `digest valid = true`
- `CMS valid = true`
- `signature valid = true`
- `certificate valid = true`
- `certificate/KMS binding = true`
- `document integrity valid = true`
- verificador primario válido
- verificador independiente válido
- perfil exactamente `PAdES-B-B`

Un fallo produce `PADES_FAILED` o el código técnico específico y no publica el PDF.

## Persistencia y Storage

Se reutilizan `document_versions`, `document_certifications`, `document_pdf_signatures`,
`certification_execution_checkpoints`, `certification_state_transitions` y los buckets
privados existentes.

- PDF visual: bucket `documents`, ruta inmutable `.../visual/{sha256}.pdf`.
- Artefactos de cada intento: bucket `certification-artifacts`, bajo
  `.../{certificationUuid}/attempt-{n}/`.
- PDF PAdES promovido: bucket `documents`, ruta inmutable
  `.../pades/{certificationUuid}-{sha256}.pdf`.
- `documentos.sealed_pdf_path` y `sealed_pdf_hash` se actualizan al final.

Storage y PostgreSQL no comparten una transacción distribuida. El flujo usa preparación,
verificación, referencias inmutables y promoción final como protocolo compensatorio. Los
intentos fallidos permanecen versionados para auditoría y nunca sobrescriben artefactos.

## Idempotencia y concurrencia

La clave idempotente se deriva de documento, versión y SHA-256 visual. Existe una sola
certificación por versión. Un registro `PENDING` sin lease activo se reanuda; un lease activo
impide una segunda ejecución concurrente. Un retry utiliza una carpeta de intento nueva y
actualiza la evidencia técnica única de la certificación solamente con el resultado vigente.

## UI

El visor deriva el estado exclusivamente de `document_certifications`:

- `SIN PADES`
- `PAdES EN PROCESO`
- `PAdES VERIFICADO`
- `PAdES ERROR`

Cuando el estado es verificado muestra perfil B-B, algoritmo, certificado, fecha de firma y
huella pública. No expone secretos ni el resource name completo de KMS.

## Prueba real

Documento Docubox: `1b992070-01de-48ba-a553-c731d2f2b2cd`
Versión: `458f5700-090a-4339-b0c5-fc2d5defe220`
Certificación: `c80f012e-c396-4a8b-9300-3b6be6baa865`

Resultados:

- PDF final descargable: PASS
- firma digital detectable: PASS
- verificación interna: PASS
- verificación independiente: PASS
- OpenSSL CMS detached: PASS
- alteración de un byte: FAIL esperado
- persistencia `document_certifications`: PASS
- promoción posterior a verificación: PASS
- retry idempotente sin duplicado: PASS
- certificaciones para la versión: 1
- timestamp: `not_configured`

Artefacto local de verificación:
`output/pdf/docubox-real-1b992070-01de-48ba-a553-c731d2f2b2cd-pades-bb.pdf`.

## Regresión

- `npm run type-check`: PASS
- `npm run test:kms:gcp`: PASS, `KMS E2E VERIFIED`
- `npm run test:kms:pades-bb`: PASS, `PADES-B-B KMS E2E VERIFIED`
- pruebas KMS, OpenBao, X.509, PAdES y orquestador: 20/20 PASS
- suite completa `tests/*.test.mjs`: 69/69 PASS
- prueba E2E del documento real: PASS
- renderizado visual con Poppler, páginas 1 y 5: PASS

## ESLint 9

Se agregó `eslint.config.mjs` y los scripts ahora invocan `eslint .`. La configuración flat
carga correctamente y conserva las reglas anteriores. El recorrido completo detectó 3,303
errores Prettier y 83 advertencias ya existentes en el repositorio. No se ejecutó un `--fix`
masivo porque modificaría cientos de archivos fuera de este WP. La migración de configuración
está operativa; la normalización histórica de formato queda como trabajo separado.

## Archivos principales

- `src/app/api/documentos/[documentId]/seal-signatures/route.ts`
- `src/lib/certification/product-integration.ts`
- `src/lib/certification/engine.ts`
- `src/lib/certification/execution.ts`
- `src/lib/certification/types.ts`
- `src/app/visor-documento/[id]/page.tsx`
- `scripts/test-real-document-pades-bb.ts`
- `scripts/bootstrap-google-kms-development-certificate.ts`
- `tests/final-pdf-metadata.test.mjs`
- `supabase/migrations/20260828153000_fix_legal_evidence_pgcrypto_resolution.sql`
- `eslint.config.mjs`
