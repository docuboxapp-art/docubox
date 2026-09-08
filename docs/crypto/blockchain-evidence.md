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

La implementación usa `OpenTimestampsCliProvider`, aislado detrás de `OpenTimestampProvider`. Se descartó el paquete npm `opentimestamps` porque su publicación disponible es antigua y depende de paquetes obsoletos. El worker debe instalar el cliente oficial `opentimestamps-client` y exponer el ejecutable con `OPENTIMESTAMPS_CLI_PATH`.

En Vercel, el proceso Next.js no incluye ese binario por defecto. Producción debe ejecutar la ruta programada en un runtime backend que contenga `ots` o mover el mismo proveedor a un worker contenedorizado. Mientras falte el binario, el sistema registra `SUBMISSION_FAILED`; nunca simula ni publica un anclaje.

## Estados verdaderos

- `PENDING_BITCOIN`: existe una prueba válida que aún no contiene una attestación Bitcoin.
- `ANCHORED`: la prueba contiene una attestación Bitcoin, pero todavía no se completó la verificación criptográfica configurada.
- `VERIFIED`: `ots verify` confirmó la prueba contra Bitcoin. Sólo entonces se emite la constancia.

`BITCOIN_VERIFICATION_MODE=LOCAL_NODE` consulta `getblockhash` y `getblockheader` en un Bitcoin Core propio sin wallet para persistir de forma independiente el hash y fecha del bloque.

## Seguridad y retención

Los artefactos viven en el bucket privado `blockchain-evidence` y usan el cifrado documental de Docubox cuando está habilitado. Las descargas se median por backend. RLS permite lectura privada sólo a usuarios con acceso al documento; escritura, claims y calendario son exclusivos de `service_role`. Los hashes y la asociación documental son inmutables, las versiones de prueba son append-only y Legal Hold activo impide eliminar el registro principal.

La purga por retención reutiliza el proceso transaccional existente de Docubox. Incluye manifiesto, todas las versiones `.ots` y constancia en el inventario de Storage; la eliminación de registros históricos sólo se admite cuando `purge_document_bundle` abre su contexto backend después de validar papelera, recuperación, retención y Legal Hold. Fuera de ese contexto, las pruebas y los intentos de calendario no se pueden actualizar ni eliminar.

La verificación pública se localiza mediante un token aleatorio de 192 bits y devuelve sólo protocolo, blockchain, hashes autorizados, bloque, fechas y resultados técnicos. No expone tenants, UUID internos, participantes, correos, IP ni infraestructura.

## Operación

El cron `/api/internal/blockchain-evidence/upgrade` requiere `Authorization: Bearer $CRON_SECRET`, reclama filas con `FOR UPDATE SKIP LOCKED`, libera claims vencidos y aplica backoff exponencial con límite de 24 horas. Una restricción única evita duplicados por `document_id + document_hash + schema_version`.
