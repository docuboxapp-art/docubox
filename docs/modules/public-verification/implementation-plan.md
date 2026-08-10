# Centro Publico de Verificacion - Plan de consolidacion

## 1. Arquitectura actual encontrada

Existen tres superficies publicas parcialmente superpuestas:

- `/verificar-documento`: busca documentos completados por UUID interno, `documento_id` o folio y muestra datos del registro.
- `/verificar-certificacion/[verificationUuid]`: recalcula hashes, sellos RSA-PSS, manifest, cadena de evidencia y artefactos del motor de certificacion.
- `/verify/promissory-note/[token]`: verificador especializado de titulos de credito.

Tambien existen APIs de NOM-151, XML de evidencia, firma, certificacion, descarga de artefactos y un motor que genera cadenas canonicas, sellos, timestamp RFC 3161, PDF certificado y paquete tecnico.

## 2. Que funciona

- Consulta de documentos completados por identificadores legacy.
- Respeto a `es_publico` para visualizar o descargar el PDF.
- URLs firmadas temporales para storage privado.
- Hashes SHA-256 de documento, PDF sellado y XML.
- Recalculo real de cadenas canonicas y manifest en `getPublicCertification`.
- Verificacion local de sellos RSA-PSS con llave publica.
- Comparacion del token RFC 3161 y su `messageImprint` registrado.
- Registro de accesos de certificacion y adaptadores que fallan de forma cerrada cuando KMS/TSA/PAdES no estan configurados.

## 3. Que esta incompleto o debe corregirse

- El portal de documentos trata localizar un registro como una verificacion satisfactoria.
- Los portales no comparten estados, contrato ni orquestador.
- Se exponen UUID internos en URLs y respuestas legacy.
- No existe entrada por hash ni comparacion local de un PDF cargado.
- NOM-151, RFC 3161, XML y paquete no tienen validadores publicos normalizados.
- La consulta de certificacion usa UUID y no token publico aleatorio hasheado.
- El rate limit en memoria no es distribuido.
- No existe historial normalizado por motor y version.
- Los participantes publicos no se enmascaran suficientemente.

## 4. Componentes y tablas reutilizables

- `documentos`, `signature_evidence`, `nom151_constancias_doc`.
- `document_certifications`, `evidence_manifests`, `evidence_manifest_items`, `timestamp_records`, `cryptographic_keys`.
- `certification_access_logs` y `certification_state_transitions`.
- `src/lib/certification/engine.ts`, `canonical.ts`, `adapters.ts`, `pdf.ts` y `zip.ts`.
- Storage privado y endpoints de artefactos existentes.

## 5. Arquitectura consolidada

`Public Verification UI -> Public Gateway -> VerificationOrchestrator -> seis motores -> repositorio de artefactos -> logs`.

Los seis motores normalizan resultados sin convertir ausencia o configuracion pendiente en exito:

1. Integridad y hash.
2. PDF/PAdES.
3. XML/XMLDSig.
4. NOM-151.
5. RFC 3161.
6. Manifest y cadena de evidencia.

## 6. Modelo de compatibilidad

- V1: PDF + hash.
- V2: PDF + NOM-151.
- V3: PDF + XML + NOM-151.
- V4: PDF + XML + manifest + timestamp + cadena de evidencia.

La ausencia de un componente que nunca pertenecio a una version se reporta `NOT_APPLICABLE`, no `INVALID`.

## 7. Nuevas entidades necesarias

- `public_verifications`: token y codigo hasheados, visibilidad, expiracion y revocacion.
- `document_artifacts`: indice normalizado de huellas y ubicaciones privadas.
- `verification_runs`: resultado reproducible con version del orquestador.
- `verification_checks`: hallazgos por motor sin booleanos simplificadores.

Se reutilizan `timestamp_records`, `evidence_manifests` y `nom151_constancias_doc`; no se duplican.

## 8. Seguridad y privacidad

- Tokens aleatorios de alta entropia; solo se almacena SHA-256.
- Compatibilidad por folio con respuesta anti-enumeracion y sin IDs internos.
- Hash local del PDF cuando solo se requiere coincidencia.
- Limites de tamano y formatos; XML con DTD/DOCTYPE rechazado.
- Datos personales enmascarados y sin storage paths.
- Rate limit con interfaz distribuible; la memoria solo es fallback local.
- Logs con IP y user-agent hasheados.
- Descarga publica unicamente cuando `es_publico` y el enlace no esta revocado.

## 9. Orden de implementacion

1. Definir estados, contratos y normalizacion.
2. Implementar repositorio compatible con documentos legacy y certificaciones actuales.
3. Implementar orquestador y adaptadores con estado `SERVICE_UNAVAILABLE` si falta proveedor.
4. Crear gateway publico por token/folio, hash, documento, NOM-151, timestamp, XML y paquete.
5. Unificar la interfaz en cinco metodos y un resultado consolidado.
6. Agregar migracion, fixtures y pruebas de integridad/hash/privacidad.
7. Mantener redireccion o compatibilidad de rutas anteriores.

## 10. Estado de implementacion

Implementado en esta iteracion:

- Portal unificado en `/verificar-documento` con consulta por folio, codigo, token, PDF, hash, NOM-151 y RFC 3161.
- Resultado consolidado por motor con estados normalizados y pestañas tecnicas.
- API publica versionada bajo `/api/public/v1/verifications`.
- Ruta publica aleatoria `/v/{token}` y emision autenticada de enlaces sin exponer UUID internos nuevos.
- Comparacion de PDF mediante SHA-256 calculado en el navegador; el PDF no se envia para la consulta por huella.
- Enmascaramiento de participantes, emisor generico, URLs temporales y logs pseudonimizados.
- Migracion para tokens hasheados, artefactos, ejecuciones y comprobaciones inmutables.
- Compatibilidad de lectura con folios, documentos y certificaciones legacy.

Pendiente de operacion antes de produccion:

1. Aplicar `supabase/migrations/20260808040000_public_verification_center.sql` en cada ambiente.
2. Configurar un rate limit distribuido; el limitador actual en memoria es solo un fallback local.
3. Conectar proveedores criptograficos reales. Si falta un proveedor, el portal responde `SERVICE_UNAVAILABLE` y nunca simula una validacion positiva.
4. Ejecutar la migracion gradual de enlaces legacy hacia tokens publicos aleatorios.

## 11. Proveedores externos

Los validadores tecnicos aceptan gateways HTTPS configurados mediante:

- `DOCUBOX_NOM151_VALIDATION_GATEWAY_URL`
- `DOCUBOX_TSA_VALIDATION_GATEWAY_URL`
- `DOCUBOX_XML_VALIDATION_GATEWAY_URL`
- `DOCUBOX_EVIDENCE_VALIDATION_GATEWAY_URL`

Cada gateway debe devolver un resultado firmado o autenticado por infraestructura controlada. La mera existencia de una constancia, XML, estampa o registro no se interpreta como verificacion criptografica.

## 12. Verificacion local

- `DOC-2026-Z4ATA1` se localiza y se clasifica `REGISTERED` con sus componentes ausentes o no aplicables.
- Las pruebas de normalizacion de hash, token y privacidad se ejecutan junto con las pruebas canonicas del motor existente.
- El build de Next.js compila las rutas publicas y APIs versionadas.
