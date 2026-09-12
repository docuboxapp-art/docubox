# Mapa de reutilizacion de APIs

## Criterios

- **SHARE DIRECTLY**: contrato HTTP ya apto para Bearer, errores y autorizacion movil.
- **ADAPT**: backend reutilizable, pero necesita normalizar auth, DTO, paginacion, idempotencia o respuesta de capacidades.
- **DO NOT SHARE**: endpoint interno, publico por token especial o privilegio que no debe usar la app autenticada.

La clasificacion es conservadora: la presencia de un endpoint no implica que su contrato este listo para terceros clientes.

## Auth y sesion

| Endpoint/capa | Metodo | Clasificacion | Cambio previo | Source files | Confidence |
|---|---|---|---|---|---|
| Supabase Auth SDK | varios | SHARE DIRECTLY | storage seguro + deep links + politica de sesion | `src/contexts/AuthContext.tsx`, Supabase config | HIGH |
| `/api/auth/check-login-options` | POST | ADAPT | confirmar Bearer/mobile challenge contract | ruta correspondiente | MEDIUM |
| `/api/auth/send-login-otp`, `/verify-login-otp` | POST | ADAPT | idempotencia, rate-limit y deep-link UX | rutas correspondientes | HIGH |
| `/api/auth/totp/*` | POST | ADAPT | separar enrollment/verify y step-up | rutas correspondientes | HIGH |
| `/api/webauthn/*` | POST/DELETE | ADAPT/FUTURE | passkeys nativas y RP/deep links requieren spike | rutas correspondientes | MEDIUM |
| `/api/security/*` | POST | ADAPT | contrato movil/telemetria sin fingerprint web | rutas correspondientes | MEDIUM |

## Documentos

| Endpoint | Metodo | Clasificacion | Cambio previo | Confidence |
|---|---|---|---|---|
| `/api/documentos/listar` | GET | ADAPT | cursor, campos compactos, Bearer consistente | HIGH |
| `/api/documentos/obtener` | GET | ADAPT | DTO unico de detalle + `allowedActions` | HIGH |
| `/api/documentos/guardar-borrador` | POST | ADAPT | idempotency key y carga movil | HIGH |
| `/api/documentos/enviar` | POST | ADAPT | step-up, idempotencia y errores tipados | HIGH |
| `/api/documentos/mis-participaciones` | GET | ADAPT | paginacion/filtros | HIGH |
| `/api/documentos/participation-requests` | GET | ADAPT | remover dependencia cookie/contexto web | MEDIUM |
| `/api/documentos/participation-responses` | GET | ADAPT | DTO paginado | MEDIUM |
| `/api/documentos/advance-participation` | POST | ADAPT | idempotencia y estado esperado | HIGH |
| `/api/documentos/send-reminder` | POST | ADAPT | Bearer, rate limit y allowed action | MEDIUM |
| `/api/documentos/update-estado` | POST | ADAPT | CAS/version y Bearer uniforme | HIGH |
| `/api/documentos/metadata` | GET/POST | ADAPT | contratos versionados | HIGH |
| `/api/documentos/[id]/additional-metadata` | GET/PATCH | ADAPT | schema dinamico/versionado | HIGH |
| `/api/documentos/[id]/viewer-file` | GET | ADAPT | streaming movil, Range/TTL/no-store | HIGH |
| `/api/documentos/[id]/permissions` | GET/POST/DELETE | OPTIONAL/ADAPT | capacidades y confirmaciones | HIGH |
| `/api/documentos/[id]/priority` | PATCH | ADAPT | allowed action + optimistic concurrency | HIGH |
| `/api/documentos/[id]/edit` | PATCH | OPTIONAL/ADAPT | alcance de edicion MVP | HIGH |
| `/api/documentos/[id]/replace-file` | POST | OPTIONAL/ADAPT | upload resumible e idempotencia | HIGH |
| `/api/documentos/papelera` | POST/PATCH/DELETE | ADAPT | retornar disposicion server-side | HIGH |
| `/api/documentos/carpetas` | GET/POST/DELETE | OPTIONAL/ADAPT | paginacion y regla carpeta vacia | HIGH |
| `/api/documentos/[id]/legal-hold` | POST/DELETE | DO NOT SHARE en MVP | administracion sensible fuera de alcance | HIGH |

Source files de la tabla: `src/app/api/documentos/**/route.ts`, `src/lib/documents/lifecycle-policy.ts`, `participant-visibility.ts`.  
Confidence global: HIGH salvo filas marcadas MEDIUM.

## Conversion, firma y evidencia

| Endpoint | Clasificacion | Requisito movil | Confidence |
|---|---|---|---|
| `/api/document-conversion/jobs` | ADAPT | upload directo firmado, cuota e idempotencia | HIGH |
| `/api/document-conversion/jobs/[id]` | SHARE DIRECTLY/ADAPT | polling con `retryAfterMs`; detener en failed | HIGH |
| `/api/firma/send-otp` | ADAPT | challenge tipado y anti-replay | HIGH |
| `/api/firma/persist-evidence` | ADAPT | coordenadas normalizadas/version del canvas | HIGH |
| `/api/firma/persist-efirma-evidence` | ADAPT | material efimero y limites de body | HIGH |
| `/api/firma/finalize-evidence` | ADAPT | idempotencia y version documental esperada | HIGH |
| `/api/firma/mobile-signature/*` | ADAPT | hoy resuelve sesion web->movil por token; no sustituye auth de app | HIGH |
| `/api/documentos/[id]/seal-signatures` | DO NOT CALL DIRECTLY | orquestacion interna/finalizacion | HIGH |
| `/api/documentos/[id]/evidence` | ADAPT | resumen compacto | HIGH |
| `/api/documentos/[id]/evidence-v2` | GET ADAPT; POST DO NOT USE | generacion no directa | HIGH |
| `/api/documentos/[id]/evidence/package` | ADAPT | descarga temporal autorizada | HIGH |
| `/api/documentos/[id]/evidence/xml` | ADAPT | descarga/preview segura | HIGH |
| `/api/documentos/[id]/mi-constancia` | ADAPT | descarga autorizada | HIGH |
| `/api/documentos/[id]/constancia-general` | ADAPT | roles y estado completed | HIGH |
| `/api/documents/[id]/certifications*` | ADAPT | DTO y artifacts | HIGH |
| `/api/documents/[id]/blockchain-evidence*` | ADAPT | lectura/solicitud con estado de job | HIGH |

Source files: `src/app/api/document-conversion`, `src/app/api/firma`, rutas de evidencia/certificacion/blockchain.  
Confidence: HIGH.

## LucIA

| Endpoint | Clasificacion | Requisito movil | Confidence |
|---|---|---|---|
| `/api/ai/ask` | ADAPT | contrato de answer/evidence/actions y paginacion | HIGH |
| `/api/ai/chat-completion` | ADAPT | streaming, cancelacion y session ID portable | HIGH |
| `/api/ai/speech-to-text` | ADAPT | codec movil, limite y permiso microfono | HIGH |
| `/api/ai/embed-document` | DO NOT EXPOSE como accion normal | indexacion orquestada por backend | HIGH |
| `/api/ai/document-intelligence/[documentId]` | ADAPT/FEATURE FLAGGED | status/read model | HIGH |
| `/api/ai/document-intelligence/analyze` | ADAPT/FEATURE FLAGGED | job asincrono, cuotas y observabilidad | HIGH |
| `/api/ai/document-intelligence/compare-versions` | ADAPT/FEATURE FLAGGED | contrato de diff/citas | HIGH |

Source files: `src/app/api/ai`, `src/lib/ai`.  
Confidence: HIGH.

## Endpoints que Mobile no debe usar

- `/api/internal/**`, `/api/admin/**`: internos o administrativos.
- `/api/public/**`, `/api/verify/**`: solo para deep links/public capabilities con su propio token, no como sustituto de autenticacion.
- Edge Functions privilegiadas de firma/cifrado: Mobile llama la fachada Docubox, no invoca funciones internas ni conserva secretos.
- API de organizacion completa, plantillas, formularios, certifica y colabora quedan fuera del MVP salvo una dependencia documental aprobada.

## Contrato transversal requerido

Antes de implementar Mobile, versionar: `ApiError`, `Page<T>`, `DocumentSummary`, `DocumentDetail`, `AllowedAction`, `Participation`, `EvidenceSummary`, `UploadJob`, `ConversionJob`, `SigningChallenge`, `LuciaAnswer`. Todas las mutaciones criticas deben admitir `Idempotency-Key` y devolver `requestId`.

