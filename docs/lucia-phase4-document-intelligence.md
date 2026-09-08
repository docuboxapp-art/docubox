# Fase 4 — LucIA Document Intelligence

## 1. Resumen ejecutivo

Se implementó una primera capa general de inteligencia documental, independiente del tipo de documento. El análisis es solicitado explícitamente, usa únicamente chunks autorizados, exige salida JSON Schema estricta, valida evidencia antes de guardar y no modifica documentos, carpetas, etiquetas, metadatos ni tareas operativas.

La migración quedó creada localmente, pero no se aplicó al Supabase enlazado. El historial remoto tiene pendiente `20260904180000_allow_draft_purge_during_recovery.sql`; un `db push` normal bloquea Fase 4 y `--include-all` incluiría ambas migraciones. Se requiere resolver primero esa decisión separada.

## 2. Archivos modificados

- `src/lib/ai/documentIntelligence.ts`
- `src/lib/ai/documentIntelligenceSchemas.ts`
- `src/lib/ai/luciaQueries.ts`
- `src/lib/ai/evidence.ts`
- `src/lib/ai/luciaIntentClassifier.ts`
- `src/lib/ai/moduleCapabilities.ts`
- `src/lib/ai/dbSchemaMap.ts`
- `src/lib/ai/security.ts`
- `src/lib/ai/redaction.ts`
- `src/app/api/ai/ask/route.ts`
- `src/app/api/ai/embed-document/route.ts`
- `src/components/LucIAChat.tsx`
- `tests/lucia-phase4-document-intelligence.test.mjs`
- `supabase/tests/lucia_phase4_document_intelligence_contract.sql`

## 3. Migraciones creadas

- `supabase/migrations/20260905174616_lucia_document_intelligence.sql`

La migración amplía `ai_document_chunks` con versión, hash documental, hash de contenido, método de extracción y fecha de indexación. No altera migraciones previamente aplicadas.

## 4. Tablas nuevas

- `ai_document_profiles`
- `ai_document_extracted_fields`
- `ai_document_entities`
- `ai_document_obligations`
- `ai_document_classifications`
- `ai_document_completeness_checks`
- `ai_document_processing_jobs`

Todas tienen RLS habilitado y forzado. `authenticated` recibe sólo `SELECT`; la lectura exige sesión, membresía activa, workspace coincidente y `can_access_documento(document_id)`. Las escrituras quedan reservadas a `service_role`.

## 5. Endpoints nuevos

- `POST /api/ai/document-intelligence/analyze`
- `GET /api/ai/document-intelligence/[documentId]?workspaceId=...`
- `POST /api/ai/document-intelligence/compare-versions`

Los tres requieren Bearer JWT válido, validan workspace y ACL, aplican rate limit distribuido y nunca aceptan `userId` del frontend.

## 6. Servicios implementados

`documentIntelligence.ts` incorpora:

- `buildDocumentIntelligenceProfile`
- `classifyDocument`
- `extractStructuredFields`
- `detectDocumentObligations`
- `checkDocumentCompleteness`
- `suggestDocumentMetadata`
- `compareDocumentVersions`
- `getDocumentIntelligenceSummary`

El pipeline registra jobs, usa chunks por documento y versión, persiste únicamente resultados validados y conserva `suggested_task` como propuesta. No existe escritura hacia `tareas`, `documentos`, carpetas o etiquetas.

## 7. Intents nuevos

- `document_intelligence_profile`
- `document_classification`
- `document_extracted_fields`
- `document_obligations`
- `document_completeness`
- `document_metadata_suggestions`
- `document_folder_suggestions`
- `document_tag_suggestions`
- `document_quality_score`
- `document_version_comparison`
- `document_evidence_sources`

## 8. Integración con LucIA

`buildStructuredContext` consulta primero la inteligencia persistida para estos intents. `buildRagContext` puede complementar perfil, clasificación y sugerencias con chunks autorizados; campos, obligaciones y completitud requieren registros estructurados con evidencia. La comparación se realiza en el endpoint dedicado y exige ambas versiones indexadas.

Se agregaron prompts contextuales en visor, documentos, expedientes, plantillas y formularios. Las rutas `disabled` y `deterministic_only` conservan sus restricciones y no reciben prompts generativos.

## 9. Evidencia y citas internas

Las fuentes incluyen:

- `source_type`
- `document_id`
- `document_version_id`
- `chunk_id`
- `page_number`
- `confidence`

Las salidas estructuradas con referencias desconocidas se rechazan. Los campos sin evidencia no se guardan; las comparaciones necesitan evidencia de las dos versiones. Los chunks heredados siguen siendo legibles, pero no sirven para una comparación versionada.

## 10. Seguridad y ACL

- El servicio rechaza contextos públicos por token para análisis persistente.
- `userId`, workspace y documento deben coincidir con `LuciaAuthorizationContext`.
- Sólo se consultan `allowed_document_ids`.
- Se redactan CURP, RFC, correos, teléfonos, secretos y capabilities antes del modelo.
- El flujo general descarta RFC, CURP, email, teléfono y domicilio extraídos.
- No se envían archivos completos; se usan hasta 24 chunks acotados.
- No hay IA generativa en validadores públicos.
- Los resultados y scores se presentan como orientativos, no como dictamen legal o fiscal.

## 11. Telemetría

Cada análisis registra tipo, documento, versión, módulo, intent, modelo, tokens, costo estimado, chunks utilizados, cantidad de resultados, confianza, estado, error y latencia mediante `ai_query_logs` y `context_used`.

No se registran documentos completos, valores extraídos, OTP, tokens, biometría, llaves, contraseñas ni material criptográfico.

## 12. Pruebas ejecutadas

- TypeScript: correcto.
- Build de producción: correcto, 220 rutas; los tres endpoints nuevos fueron compilados.
- Fases 1, 2, 3, 3.6 y 4: 50/50 correctas.
- Fase 4 aislada: 13/13 correctas.
- ESLint focalizado: 0 errores; permanecen advertencias no bloqueantes de `any` en código heredado y adaptadores Supabase.
- `git diff --check`: correcto; sólo se mostraron avisos de conversión LF/CRLF.
- Prueba manual sin sesión: analyze, read y compare respondieron 401.
- Contrato SQL post-migración: creado; pendiente de ejecución en staging después de aplicar la migración.
- Dry-run Supabase normal: bloqueado por la migración anterior pendiente.
- Dry-run Supabase con `--include-all`: reconoce la migración anterior y Fase 4; no se aplicó ninguna.

## 13. Riesgos pendientes

- La extracción PDF actual sigue siendo heurística (`Tj/TJ`) y no ofrece página fiable.
- No existe OCR documental general. Los PDFs escaneados/protegidos y formatos Office sin extractor devuelven un error tipado; no se simula contenido.
- El pipeline se ejecuta dentro de la solicitud HTTP. La tabla de jobs aporta trazabilidad, pero todavía no existe worker asíncrono con reintentos.
- Los chunks heredados no contienen versión/hash hasta reindexarse.
- `document_metadata` pertenece al modelo legado `documents`; Fase 4 usa `documentos` y `document_versions` y no depende de esa tabla.
- Falta aplicar la migración y ejecutar pruebas de RLS contra una base de staging con usuarios reales de distintos workspaces.

## 14. Recomendaciones para Fase 5

1. Resolver y aplicar por separado la migración pendiente de purga; después aplicar Fase 4 en staging.
2. Incorporar extracción server-side por formato con páginas reales y detección explícita de PDF protegido/escaneado.
3. Añadir OCR general mediante un proveedor aprobado, con minimización, residencia y retención definidas.
4. Ejecutar jobs en un worker/queue idempotente con reintentos, leasing y dead-letter handling.
5. Reindexar progresivamente chunks heredados por versión y hash.
6. Añadir UI de ficha documental y confirmación humana antes de cualquier futura aplicación de sugerencias.
