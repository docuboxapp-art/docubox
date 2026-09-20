# Docubox - Remediación del gate pre-production

Fecha: 2026-09-14
Alcance: corrección de código/schema y clasificación de fallos.
Producción: no modificada.

## Feature flags

La causa de `PHASE_E_FEATURE_FLAG_SCHEMA` era una segunda interpretación del contrato
de `platform_feature_flags`. Fase E y dos migraciones posteriores usaban
`feature_key`, `enabled` y `configuration`, mientras que la tabla canónica creada por
el control plane usa `flag_key`, `global_enabled`, `rollout_percentage` y
`allowed_plans`.

Se corrigieron las tres migraciones core no aplicadas para consumir el contrato
canónico y se alinearon el lector server-side y los contratos pgTAP. No se creó una
tabla paralela, no se modificaron los cuatro prerrequisitos ya aplicados y todos los
flags nuevos permanecen en `FALSE` con rollout `0`.

No se creó una migración correctiva posterior porque la migración core de Fase E es
un archivo nuevo, no rastreado y todavía no aplicado; una corrección posterior no
podría reparar una cadena que falla antes de alcanzarla.

## Orden de migraciones

Prerrequisitos, en orden:

1. `20260913013624_document_view_access_protection_v2.sql`
2. `20260913021500_document_view_access_admin_events.sql`
3. `20260913055126_template_publication_context.sql`
4. `20260913060728_template_approval_workflow_instance.sql`

Core, en orden:

1. `20260913180815_phase_a_security_foundations.sql`
2. `20260913213000_phase_b_document_packages.sql`
3. `20260913234153_auth_003_atomic_participant_completion.sql`
4. `20260914003615_phase_c_orchestration_agreement_actions.sql`
5. `20260914012827_phase_d_advanced_organization.sql`
6. `20260914033655_phase_e_intelligence_enterprise_integrations.sql`
7. `20260914050356_auth_e_002_bulk_signature_runtime.sql`
8. `20260914054518_auth_e_001_workflow_builder_canonical_runtime.sql`
9. `20260914151842_workflow_builder_v2_deferred_nodes.sql`
10. `20260914165651_group_member_delegation.sql`
11. `20260914180703_cross_tenant_document_custody.sql`

El contrato estático de remediación valida este orden, un único schema de flags y
las firmas públicas reemplazadas. La ejecución real de DDL/RLS sigue pendiente por
falta de una base no productiva.

## Reemplazos versionados

Todos se clasificaron `EXPECTED_SAFE_REPLACEMENT`:

- `claim_participant_completion`: AUTH-003 -> Fase D -> delegación de miembro;
  misma firma pública, wrappers encadenados y validaciones preservadas.
- `commit_participant_completion`: AUTH-003 -> Fase D; misma firma pública y llamada
  explícita a la implementación anterior.
- `create_bulk_campaign_with_recipients`: misma firma y retorno; la segunda versión
  completa hardening/runtime y conserva el grant de servicio.
- Funciones de validación, publicación, inicio y avance de Workflow V1 -> V2: firmas
  exactas y version pinning preservado.
- `transfer_document_custody`, `apply_document_retention_policy` y
  `can_manage_document_package`: mismas firmas; amplían custodia vigente sin reducir
  autorización ni alterar referencias históricas.

## Lint focalizado

De los 454 errores originales:

- `ROADMAP_INTRODUCED`: 442, corregidos sin cambio funcional. Eran formato Prettier
  en 10 archivos y tipos DOM no disponibles en `src/middleware.ts`.
- `PREEXISTING/DEFERRED_OUT_OF_SCOPE`: 12, todos en las dos rutas SSO diferidas.
- `GENERATED_OR_TOOLING`: 0 dentro del conjunto focalizado original.
- Resultado roadmap: 0 errores; permanecen 32 warnings no bloqueantes.

## Doce fallos globales originales

| Archivo / prueba | Clasificación | Causa raíz y resolución |
| --- | --- | --- |
| `blockchain-evidence.test.mjs` - acceso de participante | `OBSOLETE_TEST` | Busca una llamada inline antigua; el visor usa ahora `requireDocumentContentAccess`, que conserva la comprobación centralizada. |
| `document-conversion.test.mjs` - bypass PDF | `OBSOLETE_TEST` | Regex sensible a una llamada que ahora ocupa varias líneas; no hay cambio de conducta. |
| `document-finalization-fail-closed.test.mjs` - persistencia posterior a evidencia | `OBSOLETE_TEST` | Espera el upsert directo anterior; AUTH-003 usa claim, evidencia y commit atómico en `/api/firma/completion`. |
| `document-page-runtime-stability.test.mjs` - guard e.firma | `OBSOLETE_TEST` | Busca una forma textual anterior; el guard fail-closed sigue presente dentro del boundary de commit. |
| `document-permissions.test.mjs` - permisos viewer/editor | `OBSOLETE_TEST` | Exige la tabla inline; ahora la autorización se centraliza en `document-access.ts`. |
| `legal-hold-domain.test.mjs` - copy del modal | `PREEXISTING_UNRELATED` | Aserción de texto UI no relacionada con el roadmap; no se alteró UI para forzarla. |
| `lucia-phase2-contextual.test.mjs` - inventario de rutas | `ROADMAP_REGRESSION` | Faltaban políticas explícitas para kiosk y verificación de evidencia. Corregido: kiosk queda deshabilitado y verificación, determinística. |
| `signature-stamp-placement.test.mjs` - NOM-151 espera PDF final | `OBSOLETE_TEST` | Espera invocación directa; el flujo actual usa el orquestador durable después de PAdES verificado. |
| `signature-stamp-placement.test.mjs` - NOM-151 del participante final | `OBSOLETE_TEST` | La solicitud se encola en el orquestador; no se ejecuta inline en `seal-signatures`. |
| `signature-stamp-placement.test.mjs` - evidencia de auditoría separada | `OBSOLETE_TEST` | Aserción de proximidad textual; el tab y el guard continúan presentes. |
| `template-docx-import.test.mjs` - caso 12 | `OBSOLETE_TEST` | Espera el flujo de sesión de la galería anterior; la importación vigente entra por `/plantillas/nueva` y sigue workspace-scoped. |
| `timestamp-formatting.test.mjs` - formatter compartido | `OBSOLETE_TEST` | Regex de una sola línea; el visor usa el formatter compartido en formato multilínea. |

Después de la corrección: 774 tests, 753 pass, 11 fail, 10 skipped. No queda
ningún fallo global atribuible al roadmap. Los cinco tests adicionales pertenecen al
contrato de esta remediación.

## Cuatro validadores crypto

| Validador / artefacto | Esperado | Actual | Clasificación |
| --- | --- | --- | --- |
| Persistencia posterior a evidencia / `firmar-documento/[id]/page.tsx` | Upsert directo después de `finalize-evidence` | Commit atómico AUTH-003 después de evidencia | `OBSOLETE_TEST` |
| NOM-151 espera PDF final / `seal-signatures/route.ts` | Llamada directa a NOM-151 | `finalizeAfterVerifiedPadesBt` encola finalización durable | `OBSOLETE_TEST` |
| NOM-151 del participante final / `seal-signatures/route.ts` | Orden inline literal | Orquestador ejecuta después del PDF PAdES verificado | `OBSOLETE_TEST` |
| Separación de evidencia / `visor-documento/[id]/page.tsx` | Guard a menos de 200 caracteres del heading | Guard preservado, composición del componente distinta | `OBSOLETE_TEST` |

Resultado reproducido: 196 validadores, 186 pass, 4 fail y 6 skipped. Los seis
skips corresponden a pruebas PAdES/TSA que requieren OpenSSL, ausente en este host.
No se modificaron algoritmos, PDF, PAdES, TSA, NOM-151, Evidence v2, cifrado ni
KMS/HSM.

## Validación

- TypeScript: pass.
- Lint focalizado roadmap: pass, 0 errores y 32 warnings.
- Tests focalizados A-E: 167/167 pass.
- Contrato de remediación: 5/5 pass.
- Tests globales: pass para roadmap; 11 fallos clasificados no-roadmap.
- Build Next.js: pass.
- pgTAP/RLS/DB E2E: no ejecutados; no existe base no productiva accesible y no se
  usó Production.
- OpenTimestamps: requisito ambiental pre-production; Python no está disponible.
- SMS: diferido, deshabilitado y fail-closed; no se configuró proveedor ni secreto.

## Conclusión

`CODE_AND_MIGRATION_GATE_READY: YES`

Quedan como bloqueos pre-production la ejecución real de las migraciones y las 276
comprobaciones pgTAP/RLS en una base no productiva, además de provisionar las
dependencias ambientales de OpenSSL/Python para ejecutar la cobertura criptográfica
sin skips. Ninguno autoriza uso de Production como sustituto.
