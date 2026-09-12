# Mapa del dominio documental

## Modelo funcional

| Entidad/capacidad | Servicio o regla | API principal | UI web | Autorizacion | Estado | Source files | Confidence |
|---|---|---|---|---|---|---|---|
| Documento | consultas y mutaciones `documentos` | `/api/documentos/listar`, `/obtener`, `/guardar-borrador`, `/enviar` | `/mis-documentos`, `/crear-documento`, `/visor-documento/[id]` | propietario, participante, workspace | IMPLEMENTED | `src/app/api/documentos`, `src/app/mis-documentos`, `src/app/crear-documento` | HIGH |
| Archivo fuente/PDF | descarga autorizada y descifrado server-side | `/api/documentos/[documentId]/viewer-file` | visor y firma | acceso efectivo al documento | IMPLEMENTED | `src/app/api/documentos/[documentId]/viewer-file/route.ts`, `src/lib/crypto/document-encryption` | HIGH |
| Conversion Office | proveedor portable Office -> PDF | `/api/document-conversion/jobs`, `/jobs/[id]` | carga de documento | usuario autenticado + cuota | IMPLEMENTED | `src/lib/document-conversion`, `src/app/api/document-conversion` | HIGH |
| Version | `document_versions` | edicion, reemplazo y comparacion | historial/versiones | permiso de lectura/edicion | IMPLEMENTED | `src/app/api/documentos/[documentId]/edit`, `replace-file`, `src/app/documentos/[documentId]/versiones` | HIGH |
| Participante | visibilidad y avance | `/mis-participaciones`, `/participation-*`, `/advance-participation` | `/mis-participaciones`, firma | participante exacto o gestor | IMPLEMENTED | `src/lib/documents/participant-visibility.ts`, `src/app/api/documentos` | HIGH |
| Permiso compartido | `document_access_permissions`, `document_user_visibility` | `/api/documentos/[documentId]/permissions` | pestaña Permisos | propietario/gestor | IMPLEMENTED | ruta indicada, migraciones de permisos | HIGH |
| Firma | evidencia, OTP, finalizacion y sellado | `/api/firma/*`, `/api/documentos/[id]/seal-signatures` | `/firmar-documento/[id]` | participante habilitado | IMPLEMENTED | `src/app/api/firma`, `src/app/firmar-documento/[id]/page.tsx`, `supabase/functions/capture-signature`, `sign-efirma` | HIGH |
| Evidencia | paquetes, XML, constancias y artefactos | `/evidence`, `/evidence-v2`, `/evidence/package`, `/evidence/xml`, `/constancia-*` | visor/descargas/verificacion | acceso autorizado o token publico acotado | IMPLEMENTED | `src/lib/evidence-v2`, `src/app/api/documentos/[documentId]` | HIGH |
| Certificacion | certificaciones y artefactos | `/api/documents/[documentId]/certifications` | visor | acceso documento + reglas de certificacion | IMPLEMENTED | `src/app/api/documents`, `src/lib/certification` | HIGH |
| Blockchain/OTS | evidencia y paquete verificable | `/api/documents/[documentId]/blockchain-evidence` | evidencia | acceso documento; verificacion publica por token | IMPLEMENTED | `src/lib/blockchain-evidence`, rutas `blockchain-evidence`, `api/opentimestamps_runtime.py` | HIGH |
| Metadatos | metadata base y adicional | `/api/documentos/metadata`, `/additional-metadata` | visor/editar | lectura o edicion segun rol | IMPLEMENTED | rutas indicadas, `src/lib/documents/final-pdf-metadata.ts` | HIGH |
| Papelera | mover, restaurar y purgar | `/api/documentos/papelera`, `/carpetas/papelera`, `/eliminaciones` | `/mis-documentos` | propietario + lifecycle policy | IMPLEMENTED | rutas indicadas, `src/lib/documents/lifecycle-policy.ts` | HIGH |
| Legal Hold/retencion | evaluacion de disposicion | `/api/documentos/[id]/legal-hold` | visor | roles autorizados | IMPLEMENTED | ruta indicada, `src/lib/documents/lifecycle-policy.ts` | HIGH |
| Prioridad | normal/high/urgent | `/api/documentos/[id]/priority` | listas/detalle | gestor autorizado | IMPLEMENTED | `src/lib/documents/priority.ts`, ruta indicada | HIGH |
| QR/verificacion | identificador/token verificable | `/api/verificacion/documentos/[identifier]`, `/api/verify/*`, `/api/public/v1|v2/verifications/*` | `/verificar-documento`, `/verificar-evidencia/[token]` | publico con alcance definido | IMPLEMENTED | rutas indicadas | HIGH |

## Estados reales

Estados documentales observados: `completado`, `pendiente`, `en_proceso`, `en_progreso`, `en_espera`, `rechazado`, `vencido`, `borrador`, `cancelado`, `parcial`. El codigo tambien normaliza aliases ingleses en reglas de lifecycle.

Estados de participacion observados: `sin_revisar`, `en_revision`, `firmo`, `rechazo`, `aprobo`, `cancelo`, `urgente_atencion`, `participacion_vencida`.

Metodos de firma visibles: `efirma`, `firma_electronica` (Click & Sign) y `autografa`.

Source files: `src/components/ui/StatusBadge.tsx`, `src/lib/documents/lifecycle-policy.ts`, `src/app/firmar-documento/[id]/page.tsx`.  
Confidence: HIGH para valores presentes; MEDIUM respecto a exhaustividad porque persisten aliases historicos.

## Reglas de ciclo de vida que Mobile debe consumir, no reimplementar

- Legal Hold bloquea papelera y purga, pero permite cancelar un workflow activo.
- Retencion vigente bloquea purga.
- Participantes activos exigen cancelar antes de enviar a papelera.
- Documentos no borrador en recuperacion conservan ventana de 30 dias.
- Borradores en papelera pueden purgarse antes de terminar esa ventana.
- La elegibilidad final se decide con `evaluateDocumentDisposition`; Mobile solo muestra acciones devueltas por backend.

Source files: `src/lib/documents/lifecycle-policy.ts`, rutas de papelera y Legal Hold.  
Confidence: HIGH.

## Conversion Office

Formatos reales: `pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`. Estados de job: `waiting`, `processing`, `finished`, `failed`. Errores publicos: `CONVERSION_QUOTA_EXHAUSTED`, `CONVERSION_USAGE_LIMITED`, `CONVERSION_RATE_LIMITED`, `CONVERSION_PROVIDER_UNAVAILABLE`, `CONVERSION_FAILED`, `CONVERSION_TIMEOUT`.

Mobile debe respetar `retryAfterMs`, no reintentar jobs ya fallidos y conservar la regla de cuota del backend.

Source files: `src/lib/document-conversion/types.ts`, `src/lib/document-conversion/server.ts`, `src/app/api/document-conversion/jobs`.  
Confidence: HIGH.

## Preparacion para Mobile

Resultado: **PARTIAL**. El dominio y los procesos existen; falta una fachada movil consistente que entregue capacidades/acciones permitidas, cursores de paginacion, errores tipados e idempotency keys. Mobile no debe replicar reglas leyendo columnas crudas.

