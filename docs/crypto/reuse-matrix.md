# Matriz de reutilizacion

Fecha de corte: 2026-08-17

| Elemento | Implementacion existente | Decision | Modificacion requerida | Riesgo | Archivo afectado |
|---|---|---|---|---|---|
| SHA-256 | `sha256Hex()` | Conservar | Declarar utilidad autoritativa y agregar vectores | Bajo | `src/lib/certification/canonical.ts` |
| SHA-256 Certifica | `sha256()` duplicado | Refactorizar | Delegar en utilidad autoritativa | Medio | `src/lib/certifica/server.ts` |
| RFC 8785 | `canonicalizeRFC8785()` | Extender | Vectores oficiales de numeros/Unicode | Medio | `src/lib/certification/canonical.ts` |
| `stableStringify()` | Orden con `localeCompare` | Sustituir | Usar canonicalizador autoritativo | Alto | `src/lib/certifica/domain.ts` |
| Orquestador tecnico | `createCertification()` | Refactorizar | Extraer etapas/checkpoints sin cambiar API | Alto | `src/lib/certification/engine.ts` |
| Producto Certifica | Casos, productos, PSC, custodia | Conservar | Integrar por `existing_document_certification_id` | Medio | `src/lib/certifica`, APIs Certifica |
| Documento operativo | `documentos` | Conservar | Fuente de negocio autoritativa | Medio | Repositorios documentales |
| Documento historico | `documents` | Compatibilidad | Adaptador de lectura y retiro gradual | Alto | Edge Functions heredadas |
| Versiones | `document_versions` | Extender | Acceso desacoplado de Colabora y estados de cierre | Alto | Migracion Colabora + nueva migracion |
| Version certificada | Entero en `document_certifications` | Extender | Agregar FK `document_version_id` y constraints cruzados | Critico | `document_certifications` |
| Origen caso Certifica | `source_document_id` | Extender | Agregar `source_document_version_id` | Alto | `certification_cases` |
| Congelamiento | Trigger de version | Conservar | Claim atomico + write-once Storage | Alto | RPC y politicas Storage |
| Cadena original | Motor tecnico | Conservar | Versionar schema y fixtures | Medio | `src/lib/certification/engine.ts` |
| Cadena de evidencia | Motor tecnico | Extender | Normalizadores de fuentes heredadas | Alto | `engine.ts`, adaptadores |
| Auditoria legal | `legal_evidence_events` | Conservar | Fuente canonica; backfill verificable | Alto | Migraciones de seguridad |
| Auditoria Certifica | `certification_case_events` | Extender | Append atomico RPC, canonicalizacion unica | Alto | `src/lib/certifica/server.ts` |
| Auditorias heredadas | Cuatro tablas documentales | Compatibilidad | Adaptadores con procedencia, no borrar | Alto | Repositorios de evidencia |
| Constancia tecnica | `src/lib/certification/pdf.ts` | Conservar | Alimentar solo resultados verificados | Medio | `pdf.ts` |
| Constancia visual legacy | `seal-pdf` | Restringir | Eliminar afirmaciones PAdES/TSA cuando no aplica firma | Critico | `supabase/functions/seal-pdf/index.ts` |
| KMS adapter | `signDigestWithKms()` | Extender | Auth obligatoria, attestation, contrato digest | Alto | `src/lib/certification/adapters.ts` |
| Registro de llaves | `cryptographic_keys` | Conservar | Huella DER, politica de exposicion minima | Medio | Migracion/configuracion |
| Configuracion PSC | `psc_providers` | Conservar | Solo para PSC comercial | Bajo | Tablas Certifica |
| Configuracion crypto | No existe equivalente completo | Crear | Referencias a secretos, health, tenant/entorno | Alto | Nueva migracion aditiva |
| VPS pyHanko | Firma/verificacion PAdES | Adaptar | Firma remota KMS; quitar PEM y DB | Alto | `vps/signer/*` |
| Gateway PAdES | `signPdfWithPades()` | Extender | Verificador independiente obligatorio | Critico | `adapters.ts`, verificador nuevo |
| TSA gateway | `requestVerifiedTimestamp()` | Extender | Parser/verificador independiente | Critico | `adapters.ts`, verificador nuevo |
| Timestamp DB | `timestamp_records` | Conservar | Completar resultados del verificador | Bajo | Tabla existente |
| NOM-151 | Dos modelos | Consolidar por adaptador | Elegir autoritativo sin borrar historial | Alto | `nom151_constancias*` |
| Storage tecnico | `certification-artifacts` | Conservar | Staging por intento, write-once, retencion | Medio | Storage/RPC |
| Storage comercial | Cuatro buckets Certifica | Conservar | Reconciliacion y legal hold | Medio | Storage Certifica |
| Portal tecnico | `/verificar-certificacion/[verificationUuid]` | Extender | Re-hash y validar PAdES/TSA en backend | Alto | `engine.ts`, portal |
| Portal comercial | `/verificar-certificacion/c/[token]` | Conservar | Mostrar reporte tecnico enlazado | Medio | API publica Certifica |
| Idempotencia tecnica | Uniques + consulta previa | Extender | Claim atomico, attempt, lease, checkpoints | Critico | BD y orquestador |
| Idempotencia PSC | Transacciones proveedor | Extender | Upsert atomico y recuperacion de respuesta | Alto | `submit/route.ts` |
| RBAC | Permisos de organizacion | Conservar | Permisos crypto dedicados | Medio | Organizacion/RLS |
| Tarjeta Integridad | UI existente en visor | Conservar | Mostrar entorno/proveedor/verificador | Bajo | `visor-documento/[id]/page.tsx` |
| Tests actuales | Canonical + sandbox | Extender | Suite T01-T24 y regresion | Critico | Tests TS/Python/SQL |

## Componentes que no deben tocarse en la primera implementacion

- Flujos actuales de e.firma SAT, autografa, Click & Sign y OTP.
- Archivo original y documentos cerrados existentes.
- IDs, folios y tablas historicas.
- Generador visual de constancia, salvo correccion de afirmaciones no verificadas.
- Sandbox Certifica y su marca `NO VALIDO / DEMOSTRACION`.

## Componentes nuevos estrictamente necesarios

1. Contratos `KeyManagementProvider`, `TimestampAuthorityProvider`, `PdfSignatureProvider`, `CertificateProvider` y `CryptoVerifier`.
2. Configuracion criptografica por tenant/entorno sin secretos directos.
3. RPCs atomicos de claim, transicion, evento y cierre.
4. Worker durable/reconciliador.
5. Verificador RFC 3161 y PAdES independiente.

No se requiere una nueva tabla de documentos, versiones, llaves publicas, timestamps, manifiestos ni casos comerciales.
