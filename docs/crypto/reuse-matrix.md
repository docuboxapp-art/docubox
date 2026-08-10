# Matriz de reutilizacion

Esta matriz decide que conservar, extender, refactorizar, sustituir o crear. Ninguna decision implica implementacion hasta recibir aprobacion explicita.

| Elemento | Implementacion existente | Decision | Modificacion requerida | Riesgo | Archivo afectado |
|---|---|---|---|---|---|
| SHA-256 | `sha256Hex()` | Conservar | Convertirlo en unica utilidad admitida para certificacion; vectores de prueba | Bajo | `src/lib/certification/canonical.ts` |
| Canonicalizacion | `canonicalizeRFC8785()` | Extender | Validar contra vectores oficiales JCS, numeros y Unicode | Medio | `src/lib/certification/canonical.ts`, `canonical.test.ts` |
| Flujo central | `createCertification()` | Refactorizar | Extraer `CertificationOrchestrator`; conservar firma publica de la API | Alto | `src/lib/certification/engine.ts` |
| Estados | `CertificationStatus` y `certification_state_transitions` | Conservar | Agregar lease, intento, checkpoint y timestamps de fallo | Medio | `src/lib/certification/types.ts`, migracion futura |
| Idempotencia | `idempotency_key` y uniques | Extender | Reclamo atomico por tenant/documento/version; respuesta estable por clave | Alto | `document_certifications`, orquestador |
| Documento principal | `documentos` | Conservar | Declararlo fuente operativa autoritativa | Medio | Repositorios y adaptadores |
| Modelo `documents` | Tabla legal historica | Compatibilidad | Adaptador de lectura; prohibir nuevas escrituras directas gradualmente | Alto | `sign-pdf-vps`, `nom151-generate` |
| Version definitiva | Solo `document_version = 1` | Crear | Tabla universal de snapshots inmutables; `case_file_document_versions` no cubre todos los documentos | Alto | Migracion futura; orquestador |
| Bloqueo documental | Estado `FREEZING_DOCUMENT` | Sustituir | Bloqueo real en BD, hash/version precondicion y rechazo de mutaciones | Critico | Migracion futura; rutas de edicion |
| Evidencia de firma | `signature_evidence` | Extender | Normalizador tipado; no duplicar participantes ni firmas | Medio | `src/lib/certification/engine.ts` |
| Evidencia tecnica | `document_evidence` | Conservar | Incluir por referencia/hash en manifiesto | Medio | Normalizador de evidencia |
| Auditoria legal | `document_audit_trail` | Conservar | Adaptador de legado hacia ledger canonico | Medio | Migraciones y repositorio |
| Integridad historica | `document_integrity_log` | Conservar | Adaptador y prueba de continuidad; no eliminar | Medio | Migraciones y repositorio |
| Actividad UI | `document_activity_log` | Conservar | Mantener como telemetria funcional, no como evidencia unica | Bajo | Sin cambio inicial |
| Ledger canonico | `legal_evidence_events` propuesto | Extender | Desplegar, backfill por referencia y append RPC; no duplicar payload sensible | Alto | `20260808120000_security_integrity_hardening.sql` |
| Manifiesto | `evidence_manifests` e items | Conservar | Reintento por upsert controlado o staging por intento | Medio | Motor y migracion futura |
| Registro central | `document_certifications` | Extender | Reutilizar como `certification_records`; agregar campos faltantes | Medio | Migracion futura no destructiva |
| Configuracion de proveedor | No existe equivalente seguro | Crear | `crypto_provider_configurations` con referencias, nunca secretos | Alto | Migracion futura |
| Inventario de llaves publicas | `cryptographic_keys` | Conservar | Renombrado no requerido; agregar procedencia/attestation ya propuesta | Medio | Hardening local |
| Timestamp | `timestamp_records` | Extender | Guardar resultado de validacion local, trust anchor y revocacion | Alto | Tabla y adaptador TSA |
| NOM-151 | `nom151_constancias` y `nom151_constancias_doc` | Unificar por adaptador | Elegir `nom151_constancias_doc` para `documentos`; preservar ambas | Alto | Rutas NOM-151 y normalizador |
| Constancia visual | `src/lib/certification/pdf.ts` | Conservar | Separar render visual de firma criptografica | Bajo | `pdf.ts` |
| PAdES gateway | `signPdfWithPades()` | Extender | Contrato tipado, verificacion independiente y reporte firmado | Critico | `adapters.ts` |
| VPS pyHanko | `vps/signer` | Sustituir gradualmente | Adaptarlo a `PadesProvider`; retirar llave PEM local de produccion | Critico | `vps/signer/*` |
| Edge `seal-pdf` | Constancia visual + hash | Restringir | No llamarlo PAdES/TSA; mantener solo para compatibilidad visual | Critico | `supabase/functions/seal-pdf/index.ts` |
| Edge `sign-pdf-vps` | Puente a VPS | Compatibilidad | Encapsular detras de proveedor; corregir `documents`/`documentos` | Alto | `supabase/functions/sign-pdf-vps/index.ts` |
| Generador local de CA | Endpoint retirado 410 | Conservar retiro | No reactivar | Bajo | `supabase/functions/generate-docubox-cert/index.ts` |
| KMS adapter | `signDigestWithKms()` | Extender | Autenticacion obligatoria, attestation, contrato digest/bytes inequívoco | Critico | `src/lib/certification/adapters.ts` |
| TSA adapter | `requestVerifiedTimestamp()` | Refactorizar | Verificacion RFC 3161 local, cadena y EKU `timeStamping` | Critico | `src/lib/certification/adapters.ts` |
| Reporte tecnico | JSON generado en engine | Extender | Persistir verificador/version/trust policy; descarga desde tarjeta | Medio | `engine.ts`, UI existente |
| Storage de artefactos | `certification-artifacts` | Conservar | Crear remoto, versionar, write-once, retention y RLS | Alto | Migracion de hardening |
| PDF firmado | `documents-signed` | Conservar | Normalizar rutas y escritura inmutable | Alto | Storage policies y adaptadores |
| Portal publico | `/verificar-certificacion/:uuid` | Conservar | Mostrar entorno, confianza, PAdES y timestamp sin filtrar PII | Medio | Pagina y API verify |
| Tarjeta de integridad | Visor documento | Extender | Incorporar estado de infraestructura y prueba integral | Bajo | `src/app/visor-documento/[id]/page.tsx` |
| Autorizacion API | `requireApiUser()` + owner | Refactorizar | Politica RBAC tenant/documento compartida | Alto | `auth.ts`, `document-access.ts` |
| RLS | Politicas locales de hardening | Extender y desplegar | Cobertura de workspace/participantes; pruebas cruzadas | Critico | Migraciones futuras |
| Observabilidad | Transiciones y logs de acceso | Extender | correlation id, attempt id, duraciones, metricas y alertas | Medio | Tablas y orquestador |
| ZIP tecnico | `createStoredZip()` | Conservar | Limites, nombres deterministas y manifiesto de contenido | Bajo | `src/lib/certification/zip.ts` |
| QR | URL de `verification_uuid` | Conservar | Entorno y estado de confianza; nunca incluir secretos | Bajo | `engine.ts`, portal publico |
| Cifrado AES-256-GCM | Flujos de identidad/documentos existentes | Separar | No mezclar con firma institucional; conservar DEK/KEK | Medio | Sin cambio inicial |
| e.firma SAT | `validate-efirma` y `sign-efirma` | Separar | Mantener como firma de participante, no llave institucional | Critico | Sin cambio inicial |

## Tablas objetivo

### Reutilizar `document_certifications`

No se recomienda crear `certification_records`. La tabla existente ya contiene identificadores, tenant, documento, version, idempotencia, estados, hashes, cadenas, sellos, rutas, errores y auditoria de creacion.

Columnas candidatas para una migracion futura no destructiva:

- `document_version_id uuid`
- `source_storage_bucket text`
- `source_storage_path text`
- `source_storage_version text`
- `source_document_updated_at timestamptz`
- `pades_profile text`
- `key_provider text`
- `certificate_serial_number text`
- `certificate_fingerprint_sha256 char(64)`
- `tsa_provider text`
- `tsa_policy_oid text`
- `verification_report_path text`
- `failed_at timestamptz`
- `failure_detail jsonb` con datos sanitizados
- `attempt_count integer`
- `lease_owner uuid`
- `lease_expires_at timestamptz`

### Crear `crypto_provider_configurations`

No existe una estructura equivalente. `cryptographic_keys` representa llaves publicas y procedencia, no configuracion por tenant. La nueva tabla solo guardaria referencias:

- `provider_type`, `provider_name`, `environment`, `enabled`
- `configuration_reference`
- `secret_reference`
- `health_status`, `last_health_check_at`
- `certificate_expires_at`
- `metadata` no sensible

No guardaria tokens, PIN, claves privadas, PKCS#12 ni contrasenas.

### Crear versionado universal

No existe un equivalente seguro de `document_versions` para `documentos`. `case_file_document_versions` es especifica de expedientes. Una tabla universal es necesaria para demostrar que se certifico exactamente una version y para impedir carreras con ediciones concurrentes.

