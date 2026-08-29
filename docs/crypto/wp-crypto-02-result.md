# WP-CRYPTO-02 Result

**Estado:** PASS de implementacion y migracion lista para aplicar.

## Verificacion

- `node --experimental-strip-types --test tests/crypto-foundation.test.mjs tests/certification-orchestrator.test.mjs`: 19 pruebas aprobadas.
- `npm run type-check`: aprobado.
- `npm run build`: aprobado.

## Entregado

- `CertificationOrchestrator` ofrece `execute`, `retry` y `getStatus`.
- El workflow recibe `KeyManagementProvider`, `TimestampAuthorityProvider` y `PdfSignatureProvider`; el engine deja de invocar KMS, TSA y PAdES directamente.
- Cada ejecucion recibe `attempt`, `trace_id`, `lease_owner`, inicio, fin y detalle de recuperacion.
- Los checkpoints se persisten en `certification_execution_checkpoints` con duracion y resultado.
- El lease aplica compare-and-swap sobre `execution_attempt` y rechaza una segunda reclamacion mientras el lease siga vigente.
- Los reintentos conservan la version congelada y enlazan su nueva ejecucion al ultimo checkpoint durable. Las operaciones posteriores deben conservar artefactos intermedios antes de ampliar la reanudacion a sellos externos.
- Se agrego `POST` y `GET` interno en `/api/internal/certifications`, protegido con un secreto solo de backend y comparacion en tiempo constante.

## Estados de ejecucion

`created -> queued -> processing -> completed`

Un fallo recuperable queda en `failed`; una condicion que exige intervencion humana queda en `manual_review`. Un reintento reclama un nuevo `attempt` y registra el checkpoint de recuperacion sin cambiar la fuente congelada.

```mermaid
flowchart LR
  I["Solicitud interna"] --> L["Lease versionado"]
  L --> C["Checkpoint durable"]
  C --> W["Engine con proveedores"]
  W --> F["Finalizacion o fallo"]
  F --> R["Retry desde fuente congelada"]
```

## Migracion requerida

Aplicar [20260821113000_wp_crypto_02_certification_orchestrator.sql](../../supabase/migrations/20260821113000_wp_crypto_02_certification_orchestrator.sql) antes de habilitar el orquestador en un ambiente compartido. La migracion es aditiva y no modifica versiones ni fuentes historicas.

## Limites deliberados

WP-CRYPTO-02 no declara PAdES, X.509 ni RFC 3161 como validos. WP-CRYPTO-03, 04, 05 y 06 deben aportar los proveedores y artefactos verificables antes de elevar esas capacidades.
