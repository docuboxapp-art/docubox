# Evidencia blockchain de Docubox

Esta capa es adicional a PAdES, RFC 3161, e.firma y NOM-151. Nunca modifica el PDF final ni se usa para afirmar identidad, consentimiento o validez jurídica.

## Punto de integración

La evidencia sólo se solicita después de que `seal-signatures` obtiene y verifica un PDF PAdES-B-T, lo persiste como artefacto final y confirma que `certified_pdf_sha256` coincide con `pades_pdf_hash_after_signature`. La indisponibilidad de OpenTimestamps no revierte ni bloquea el documento firmado.

## Compromiso enviado

1. Docubox recalcula SHA-256 del PDF final desde Storage privado.
2. Reutiliza el SHA-256 canónico de la cadena de evidencia existente.
3. Construye `Docubox Blockchain Evidence Manifest v1` mediante canonicalización RFC 8785.
4. El cliente oficial `ots stamp` calcula SHA-256 de esos bytes y agrega un nonce aleatorio de 16 bytes antes de formar el compromiso Merkle.
5. Los calendarios reciben ese compromiso cegado. No reciben el PDF, el manifiesto, hashes directos del documento, identificadores internos ni PII.

El archivo `.ots` resultante permanece compatible y portable. Cada upgrade se conserva como una versión nueva y append-only; nunca se sobrescribe silenciosamente.

## Runtime del proveedor

La implementación permanece aislada detrás de `OpenTimestampProvider`. En Vercel,
`OpenTimestampsHttpProvider` invoca una función Python 3.12 protegida que instala
`opentimestamps-client==0.7.2` y ejecuta el cliente oficial dentro de `/tmp`. El proceso Node de
Next.js nunca presupone que `ots` exista en su imagen. En Docker,
`OpenTimestampsCliProvider` y el mismo contrato HTTP permiten usar el ejecutable local sin cambiar
la lógica documental.

La función Python sólo acepta manifiesto canónico o pruebas `.ots`, valida los SHA-256 recibidos,
impone la allowlist server-side y elimina todos los temporales al terminar. No recibe PDF, UUID,
tenant, participantes ni otros datos personales.

La activación requiere simultáneamente `DOCUBOX_BLOCKCHAIN_EVIDENCE_ENABLED`,
`OPENTIMESTAMPS_ENABLED` y `OPENTIMESTAMPS_REAL_ANCHORING_ENABLED`. El flag público de interfaz se
mantiene apagado hasta completar la prueba real del runtime desplegado.

## Estados verdaderos

- `PENDING_BITCOIN`: existe una prueba válida que aún no contiene una attestación Bitcoin.
- `ANCHORED`: la prueba contiene una attestación Bitcoin, pero todavía no se completó la verificación criptográfica configurada.
- `VERIFIED`: `ots verify` confirmó la prueba contra Bitcoin. Sólo entonces se emite la constancia.

`BITCOIN_VERIFICATION_MODE=LOCAL_NODE` consulta `getblockhash` y `getblockheader` en un Bitcoin Core propio sin wallet para persistir de forma independiente el hash y fecha del bloque. Sin un nodo verificable, una prueba completa puede avanzar a `ANCHORED`, pero no a `VERIFIED`.

## Seguridad y retención

Los artefactos viven en el bucket privado `blockchain-evidence` y usan el cifrado documental de Docubox cuando está habilitado. Las descargas se median por backend. RLS permite lectura privada sólo a usuarios con acceso al documento; escritura, claims y calendario son exclusivos de `service_role`. Los hashes y la asociación documental son inmutables, las versiones de prueba son append-only y Legal Hold activo impide eliminar el registro principal.

La purga por retención reutiliza el proceso transaccional existente de Docubox. Incluye manifiesto, todas las versiones `.ots` y constancia en el inventario de Storage; la eliminación de registros históricos sólo se admite cuando `purge_document_bundle` abre su contexto backend después de validar papelera, recuperación, retención y Legal Hold. Fuera de ese contexto, las pruebas y los intentos de calendario no se pueden actualizar ni eliminar.

La verificación pública se localiza mediante un token aleatorio de 192 bits y devuelve sólo protocolo, blockchain, hashes autorizados, bloque, fechas y resultados técnicos. No expone tenants, UUID internos, participantes, correos, IP ni infraestructura.

## Operación

Los disparadores `/api/internal/jobs/opentimestamps/stamp` y
`/api/internal/jobs/opentimestamps/upgrade` requieren `Authorization: Bearer $OTS_WORKER_SECRET`
con fallback a `CRON_SECRET`. El cron combinado heredado sigue disponible para el plan Hobby de
Vercel, que sólo admite ejecución diaria. La migración futura a un scheduler cada 5 minutos para
stamp y cada 60 minutos para upgrade está preparada en `workers/ots-worker`.

Las colas separadas reclaman filas con `FOR UPDATE SKIP LOCKED`, liberan claims vencidos y aplican
backoff exponencial con límite de 24 horas. Una restricción única evita duplicados por
`document_id + document_hash + schema_version`.

El diagnóstico interno `/api/internal/opentimestamps/health` expone únicamente disponibilidad del
cliente, calendarios alcanzables, Storage, base de datos, contadores y latencias sin PII. La ruta
`/api/internal/opentimestamps/probe` crea una prueba controlada sin PII y la guarda en el bucket
privado; no activa la función para documentos reales.
