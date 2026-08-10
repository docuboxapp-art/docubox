# Analisis de brechas

## Resumen ejecutivo

Docubox ya tiene un esqueleto avanzado de certificacion, pero aun no cumple los criterios para presentarse como infraestructura productiva PAdES/KMS/RFC 3161. Las brechas principales son el versionado inmutable, la atomicidad del orquestador, la verificacion criptografica independiente, el aislamiento tenant consistente y la eliminacion de afirmaciones PAdES en flujos que solo agregan una constancia visual.

## Brechas por responsabilidad del orquestador

| Responsabilidad | Estado actual | Brecha |
|---|---|---|
| Confirmar documento concluido | Implementado sobre `documentos.estado` | Falta verificar participantes, firmas, jobs pendientes y estado legal consolidado |
| Obtener version definitiva | Descarga `file_url`/`sealed_pdf_path` | No existe snapshot universal ni `document_version_id`; version fija en 1 |
| Bloquear modificaciones | Transicion `FREEZING_DOCUMENT` | No bloquea filas, Storage ni rutas de edicion |
| Hash previo | Implementado | Falta comparar con hash persistido y registrar procedencia exacta del objeto |
| Recuperar evidencias | Implementado parcialmente | Normalizacion incompleta de tipos; no incluye toda evidencia historica/adjuntos |
| Cadena original | Implementada con JCS + texto | Debe congelarse como esquema versionado y validarse con vectores externos |
| Cadena de evidencia | Implementada | Depende de ledger local aun no desplegado; backfill no validado remotamente |
| Constancia tecnica | Implementada | Debe desacoplarse por completo de afirmaciones no verificadas |
| Preparar PDF | Implementado con `pdf-lib` | Falta snapshot del PDF intermedio y reglas deterministas de metadatos |
| Firma por proveedor | Implementada como gateway | Contrato no versionado; token es opcional; no hay attestation obligatoria |
| Insertar certificado/cadena | Delegado a gateway PAdES | Respuesta no se inspecciona localmente |
| Timestamp RFC 3161 | Delegado a gateway | No se parsea ni valida ASN.1 localmente |
| Finalizar PAdES | Delegado a gateway | No hay validacion independiente de perfil B-T |
| Verificacion criptografica | Parcial en portal | Verifica sellos KMS, no CMS/ByteRange/cadena PAdES de forma independiente |
| Hash final | Implementado | Falta bind explicito al objeto Storage versionado e inmutable |
| Guardar evidencias | Implementado | Reintentos pueden colisionar con archivos ya subidos (`upsert:false`) |
| Auditoria | Implementada por transiciones | Actualizacion de estado y evento no son atomicos |
| Estado final | Implementado | No hay transaccion de commit final que compruebe todos los precondicionados |

## Idempotencia y reintentos

- Existe `UNIQUE (tenant_id, idempotency_key)` y `UNIQUE (document_id, document_version)`.
- La busqueda principal ignora la clave de idempotencia y busca documento/version.
- Un registro `FAILED` se reinicia en la misma fila, pero no existe `attempt_id` ni checkpoints durables.
- Los artefactos usan rutas deterministas y `upsert:false`; un fallo posterior a una carga puede hacer fallar el reintento.
- Dos solicitudes simultaneas pueden competir antes de que una insercion gane el constraint.
- No existe lease, `SELECT ... FOR UPDATE SKIP LOCKED`, cola ni worker recuperable.

Conclusión: hay protecciones parciales contra duplicados, pero el flujo no es aun idempotente ni reintentable de extremo a extremo.

## Transaccionalidad

`transition()` actualiza `document_certifications` y luego inserta la transicion en dos operaciones independientes. El manifiesto, items, timestamp, artefactos y cierre tambien se persisten por separado. Supabase Storage no puede formar parte de una transaccion PostgreSQL.

Se requiere un patron saga con:

- transacciones cortas por checkpoint;
- outbox durable;
- operaciones externas idempotentes;
- staging de artefactos por intento;
- commit final atomico en BD;
- reconciliador de artefactos huerfanos.

## Multi-tenant y RBAC

- El motor asigna `tenant_id = workspace_id || owner_id`, lo cual es razonable como compatibilidad.
- Las APIs privadas autorizan solamente al `owner_id`; no modelan roles de workspace.
- Las politicas nuevas `can_access_documento()` amplian lectura a miembros/participantes, pero aun no estan desplegadas.
- No existe permiso dedicado como `certification.execute`, `certification.view` o `certification.configure`.
- `cryptographic_keys` fue originalmente legible con `USING (true)`; el hardening local debe reemplazar esa politica por lectura controlada o una proyeccion publica minima.

## KMS y custodia de llaves

- El adaptador moderno evita llaves privadas en Node y valida RSA-PSS localmente.
- `DOCUBOX_CRYPTO_GATEWAY_TOKEN` es opcional; un endpoint sin autenticacion podria aceptarse accidentalmente.
- No se registra attestation obligatoria, politica de uso, identidad del workload ni prueba de custodia.
- El VPS heredado usa una llave PEM de software, RSA-2048 y `key_passphrase=None`.
- `generate_p12.sh` contiene una contrasena fija de ejemplo y recomienda poner un PKCS#12 en Supabase Vault.
- `vps/signer/pades_core.py` posee service-role de Supabase, acoplando firma y acceso total a datos.

Brecha recomendada: OpenBao Transit como primer proveedor de desarrollo, con AppRole/workload identity, RSA-3072, politicas por proposito y sin exportacion de llave.

## PAdES

- El gateway moderno solicita `PAdES-B-T`, pero solo comprueba banderas JSON del proveedor.
- El VPS pyHanko puede firmar y verificar, pero su llave local no satisface el modelo de custodia objetivo.
- `seal-pdf` reconoce que no aplica criptografia, pero inserta textos que afirman PAdES, DigiCert y Docubox CA.
- No hay pruebas automatizadas de `ByteRange`, CMS, cadena X.509, EKU, firma alterada o PDF corrupto.
- No existe una politica documentada de confianza, revocacion, LTV o perfiles B-B/B-T/B-LT.

## RFC 3161

- El adaptador acepta `VALID`, `token_signature_valid` y `tsa_certificate_valid` enviados por el gateway.
- No se verifica localmente la firma del token, el `messageImprint`, nonce, policy OID, EKU `timeStamping`, cadena o revocacion.
- El VPS usa por defecto `http://timestamp.digicert.com`; la confianza y disponibilidad no estan encapsuladas por tenant/entorno.
- NOM-151 y RFC 3161 son flujos distintos y no deben presentarse como equivalentes.

## Datos y duplicidades

1. `documentos` y `documents` modelan el mismo concepto con identificadores y estados distintos.
2. `document_audit_trail`, `document_integrity_log`, `document_activity_log` y `legal_evidence_events` se superponen.
3. `nom151_constancias` y `nom151_constancias_doc` son dos modelos activos.
4. `document_signature_seals` y `document_certifications` pueden confundirse, aunque uno registra sellos de firma y el otro certificacion institucional.
5. Existen al menos tres caminos de PDF final: `seal-pdf`, `sign-pdf-vps` y `CertificationOrchestrator` propuesto.

La solucion es una capa de adaptadores y un modelo autoritativo, no eliminar tablas historicas.

## Observabilidad

Ya existen `correlation_id`, transiciones y logs de acceso en migraciones locales. Faltan:

- `attempt_id` y `attempt_count`;
- duracion por etapa;
- nombre/version del proveedor por llamada;
- clasificacion reintentable/no reintentable;
- health checks persistidos;
- metricas y alertas por tenant/entorno;
- redaccion central de errores;
- outbox para notificaciones y reanudacion.

## Interfaz

La tarjeta existente muestra estado del documento y presencia de tres variables. No muestra todavia:

- entorno;
- proveedor y tipo de proteccion;
- certificado, vigencia y confianza;
- motor/perfil PAdES;
- TSA/policy OID;
- ultima prueba integral;
- incidencias clasificadas;
- descarga del reporte de salud.

No debe mostrar `Produccion operativa` mientras la llave sea PEM/software o la CA sea interna.

## Brechas del remoto Supabase

- Esquema del motor nuevo no confirmado/desplegado.
- Buckets nuevos ausentes.
- Funciones nuevas no desplegadas.
- Politicas anonimas de identidad aun expuestas al momento de la revision.
- No hay credenciales administrativas activas en la sesion para aplicar o verificar DDL.

Estas brechas impiden declarar el motor operativo, aun cuando el codigo local exista.

