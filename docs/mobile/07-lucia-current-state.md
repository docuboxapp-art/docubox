# LucIA: estado actual

## Dictamen

`LUCIA_CURRENT_STATE = PARTIAL`.

El asistente, autorizacion, RAG, embeddings, voz y analisis documental existen en codigo. La inteligencia documental avanzada esta detras de `LUCIA_DOCUMENT_INTELLIGENCE_ENABLED`; la configuracion de ejemplo la deja en `false`. La presencia del codigo no prueba cobertura operacional de todos los documentos ni adopcion productiva.

## Inventario

| Capacidad | Estado | Evidencia | Source files | Confidence |
|---|---|---|---|---|
| Chat global y contextual | IMPLEMENTED | UI, contexto y endpoints | `src/components/LucIAChat.tsx`, `src/contexts/LuciaAssistantContext.tsx`, `/api/ai/ask`, `/chat-completion` | HIGH |
| Auth Bearer para IA | IMPLEMENTED | `requireAiUser` valida token | `src/lib/ai/security.ts` | HIGH |
| Autorizacion por workspace/documento | IMPLEMENTED | construye contexto de membresia, rol y documentos permitidos | `src/lib/ai/luciaAuthorization.ts`, `authorizationRules.ts` | HIGH |
| Rate limit distribuido | IMPLEMENTED | RPC por IP/user/workspace/grant | `src/lib/ai/security.ts`, migracion `lucia_phase1_security` | HIGH |
| Redaccion y limites de body | IMPLEMENTED | limites por endpoint y redaction helper | `src/lib/ai/security.ts`, `src/lib/ai/redaction.ts` | HIGH |
| RAG/chunks/embeddings | IMPLEMENTED en codigo; PARTIAL operacional | tabla, RPC y endpoint de indexacion; cobertura de corpus no demostrada | `src/lib/ai/luciaQueries.ts`, `/api/ai/embed-document`, migraciones AI | HIGH/MEDIUM |
| Posvalidacion contra evidencia | IMPLEMENTED | valida soporte de respuesta | `src/lib/ai/evidence.ts` | HIGH |
| Speech-to-text | IMPLEMENTED | endpoint y modelo configurado | `/api/ai/speech-to-text`, `src/lib/ai/security.ts` | HIGH |
| Clasificacion/extraccion/obligaciones/completitud | FEATURE FLAGGED | endpoints y tablas existen, flag requerido | `src/lib/ai/documentIntelligenceFeature.ts`, `documentIntelligence.ts`, rutas `document-intelligence` | HIGH |
| Comparacion de versiones | FEATURE FLAGGED | endpoint implementado bajo la misma familia | `/api/ai/document-intelligence/compare-versions` | HIGH |
| Busqueda natural multi-documento | PARTIAL | contexto estructurado y RAG; no hay contrato movil/producto completo | `src/lib/ai/luciaQueries.ts`, `luciaAuthorization.ts` | MEDIUM |
| Alertas inteligentes | NOT FOUND como sistema productivo | no se encontro orquestacion dedicada | inventario `src/lib/ai`, `src/app/api/ai` | MEDIUM |
| Acciones autonomas sobre documentos | NOT FOUND y no recomendadas para MVP | LucIA consulta; no hay capa aprobacion/command bus dedicada | mismas fuentes | MEDIUM |

## Proveedor y modelos observados

- Provider: `OPEN_AI`.
- Chat: `gpt-4o-mini`.
- Embeddings: `text-embedding-3-small`.
- Transcripcion: `gpt-4o-transcribe`.
- Prompt version: `lucia-phase4-document-intelligence`.

Source files: `src/lib/ai/security.ts`.  
Confidence: HIGH para constantes del commit; MEDIUM para runtime desplegado, no inspeccionado en esta auditoria.

## Datos

Tablas observadas: `lucia_sessions`, `lucia_messages`, `ai_document_chunks`, `ai_query_logs`, `ai_rate_limit_buckets`, `ai_document_profiles`, `ai_document_extracted_fields`, `ai_document_entities`, `ai_document_obligations`, `ai_document_classifications`, `ai_document_completeness_checks`, `ai_document_processing_jobs`.

Source files: migraciones `20260514230000_lucia_sessions_messages.sql`, `20260514250000_ai_document_chunks_and_logs.sql`, `20260904170000_lucia_phase1_security.sql`, `20260905174616_lucia_document_intelligence.sql`.  
Confidence: HIGH sobre esquema versionado; no se afirma volumen o cobertura productiva.

## Limite actual

La autorizacion construye una lista de documentos accesibles y limita el escaneo a 1000. Esto es correcto como defensa inicial, pero no escala como capa de retrieval multi-documento. La version movil requiere recuperar candidatos mediante consulta/RPC paginada que aplique autorizacion en base de datos antes de embeddings/LLM.

Source files: `src/lib/ai/luciaAuthorization.ts`.  
Confidence: HIGH.

