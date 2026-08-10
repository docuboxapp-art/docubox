# Auditoria de integridad criptografica y evidencia digital

Fecha: 2026-08-08  
Alcance: repositorio local de Docubox en `C:\proyectos\docubox`  
Estado: diagnostico previo a implementacion. No se modifico codigo de ejecucion.

## 1. Resumen ejecutivo

Docubox ya contiene una base valiosa para una Constancia Tecnica de Integridad y Evidencia Digital. El nucleo mas solido se encuentra en `src/lib/certification`: canonicalizacion determinista, hashes sobre bytes reales, cadenas de documento y evidencia, manifest, idempotencia, adaptadores fail-closed para KMS/TSA/PAdES, artefactos privados y verificacion publica que distingue registro de verificacion.

Sin embargo, este nucleo convive con flujos anteriores que usan otro modelo de datos, simulan verificaciones, aceptan evidencia declarada por el cliente o presentan un PDF visual como si fuera PAdES. En el estado actual no debe afirmarse una certificacion criptografica integral en produccion salvo que el registro moderno haya terminado en `COMPLETED` con proveedores reales y posteriormente se revalide con un validador independiente.

Inventario medido: 118 API routes, 23 Edge Functions, 145 migraciones SQL y solo 2 pruebas automatizadas del dominio revisado. La cobertura actual no demuestra interoperabilidad PAdES, validacion RFC 3161, cadena X.509, revocacion, e.firma SAT, RLS, concurrencia ni recuperacion ante fallas.

### Dictamen

- El motor moderno de certificacion se debe **conservar y extender**.
- Los adaptadores HTTP actuales son contratos de integracion, no implementaciones KMS/TSA/PAdES.
- `public.documentos` debe ser la entidad documental canonica. `public.documents` debe quedar como legado de solo lectura durante la migracion.
- La evidencia legal no puede depender de `document_activity_log` ni de JSON mutable en `documentos.participantes`.
- Los flujos heredados `seal-pdf`, `sign-efirma`, `validate-efirma`, `generate-xml-evidence` y `generate-docubox-cert` no deben producir afirmaciones de validez criptografica.
- Antes de produccion deben corregirse autorizacion, secretos, OTP, cifrado autenticado, custodia de llaves, validacion de certificados y revalidacion independiente de PAdES/RFC 3161.

## 2. Hallazgos prioritarios

### P0 - Bloqueantes de seguridad o validez

1. **Llave institucional insegura y secreto conocido.** `supabase/functions/generate-docubox-cert/index.ts` contiene la contrasena fija `docubox_signing_2025`, genera RSA-2048 extractable y un certificado autofirmado denominado `Docubox CA`. La misma credencial aparece en el flujo de generacion. Todo material producido por ese mecanismo debe considerarse comprometido, rotarse y clasificarse como legado no confiable.
2. **e.firma simulada o aceptada por declaracion.** `supabase/functions/validate-efirma/index.ts` contiene una ruta de aceptacion estructural cuando falla la verificacion real; `supabase/functions/sign-efirma/index.ts` registra `OCSP simulado`, puede sustituir el hash del PDF por el hash del ID y acepta metadatos de certificado aportados por el cliente. `src/app/api/firma/persist-efirma-evidence/route.ts` permite persistir `signatureHash`, RFC, serie y estado Nubarium enviados por el cliente y avanzar el documento sin verificar una firma criptografica en el servidor.
3. **Endpoints privilegiados sin autorizacion documental.** `src/app/api/nom151/generate/route.ts`, `src/app/api/nom151/constancia/route.ts` y `src/app/api/nom151/xml-evidence/route.ts` usan service role sin autenticar ni autorizar al solicitante. Permiten consultar evidencia o provocar operaciones costosas con solo conocer un UUID. El generador NOM-151 tambien registra identificador del usuario del proveedor y parte de la respuesta externa.
4. **Sellado visual presentado como firma.** `supabase/functions/seal-pdf/index.ts` declara expresamente que omite PKCS#7/PAdES, pero genera nombres y metadatos que inducen a interpretar el resultado como firmado. El hash mostrado dentro de la pagina visual se prepara antes del guardado final y puede no corresponder al PDF resultante.
5. **OTP de firma debil.** `src/app/api/firma/send-otp/route.ts` usa `Math.random`, guarda el OTP en texto claro, compara sin tiempo constante, no limita intentos ni frecuencia, no vincula de forma robusta el destinatario al participante y continua aunque falle la escritura en base de datos. La tabla se reutiliza tambien para recuperacion de contrasena.
6. **Cifrado biometrico no autenticado y no recuperable.** `src/app/api/enrollment/process-captures/route.ts` usa AES-256-CBC, reutiliza el mismo IV para varias cargas y genera una llave aleatoria al arrancar si falta la variable de entorno. No existe etiqueta de autenticacion; un reinicio puede hacer imposible descifrar datos anteriores. El face match y OCR de esa ruta son simulaciones.

### P1 - Riesgos altos de integridad y arquitectura

1. **Dos agregados documentales incompatibles.** La aplicacion actual usa `public.documentos`; auditoria, integridad, XML y PAdES heredados usan `public.documents`. No existe trigger o vista de sincronizacion. `document_audit_trail` y `document_integrity_log` conservan FK a `documents`, mientras el motor moderno consulta esos logs usando IDs de `documentos`.
2. **Auditoria fragmentada.** Existen al menos `security_audit_log`, `document_audit_trail`, `document_integrity_log`, `document_activity_log`, `signature_evidence`, `firma_eventos`, logs de formularios, expedientes, identidad, certificacion y verificacion. La UI mezcla varios y elimina duplicados por proximidad temporal; eso no constituye una cadena canonica.
3. **PAdES heredado no apto para produccion.** `vps/signer` usa pyHanko y puede generar una firma PDF real, pero carga una clave privada sin cifrar desde disco, usa por defecto una TSA por HTTP, expone CORS `*`, confia en un token estatico y reporta sujeto/nivel de firma con valores fijos. Su verificador considera principalmente integridad de bytes y no demuestra confianza de cadena/revocacion. La Edge Function que lo invoca usa `documents`, ignora fallas de persistencia y escribe columnas de auditoria que no coinciden con el esquema.
4. **Verificacion incompleta.** El motor moderno recalcula hashes y verifica sellos RSA-PSS, pero la consulta publica no vuelve a validar criptograficamente PAdES ni el CMS RFC 3161; confia en el estado persistido y en el hash del token. Tampoco construye una ruta de confianza X.509 ni consulta OCSP/CRL.
5. **Gateway insuficientemente autenticado.** `src/lib/certification/adapters.ts` acepta un bearer opcional. Faltan mTLS o identidad de workload, firma de solicitudes, nonce, proteccion anti-replay, audience, limites de respuesta y validacion estructural estricta.
6. **RLS desigual.** `documentos` protege al propietario, pero varias APIs con service role no replican esa autorizacion. `document_signature_seals` permite leer todos los sellos a cualquier autenticado. `document_metadata` permite INSERT/UPDATE a cualquier autenticado sin comprobar propiedad. Las tablas modernas de certificacion solo contemplan al propietario y no una matriz RBAC de workspace.
7. **URLs demasiado longevas.** `src/app/api/documentos/enviar/route.ts` crea y persiste una URL firmada por un ano. El portal nuevo usa cinco minutos y debe ser el patron canonico.
8. **Afirmaciones visuales no respaldadas.** Hay textos de UI/PDF que afirman AES-256, NOM-151 o PAdES aunque el artefacto solo este almacenado en bucket privado o el servicio no haya sido validado.

### P2 - Madurez operativa

- Las transiciones, escrituras, uploads y finalizacion de certificacion no forman una transaccion distribuida; pueden quedar artefactos huerfanos o estados parciales.
- La reanudacion de certificaciones fallidas existe, pero no hay worker durable ni politica general de backoff/dead-letter.
- El rate limit publico vive en memoria del proceso y no funciona globalmente en multiples instancias.
- No se registra explicitamente `development`, `staging` o `production` dentro del paquete certificado.
- No hay pruebas de vectores RFC 8785 oficiales, PAdES interoperable, RFC 3161, X.509, revocacion, RLS, concurrencia o restauracion.

## 3. Matriz de inventario

Leyenda de accion: A conservar, B extender, C refactorizar, D sustituir, E crear.

| # | Capacidad | Existe | Estado | Ubicacion principal | Reutilizable | Riesgo | Accion recomendada |
|---:|---|---|---|---|---|---|---|
| 1 | Generacion SHA-256 | Si | Duplicado | `src/lib/certification/canonical.ts`, APIs y Edge Functions | Si, nucleo Node | Medio | **C** Centralizar contratos y vectores; conservar implementaciones por runtime solo cuando sean necesarias. |
| 2 | Hash antes de certificacion | Si | Completo en motor nuevo | `src/lib/certification/engine.ts` | Si | Bajo | **A** Hash sobre bytes descargados; fijar version del objeto. |
| 3 | Hash despues de certificacion | Si | Completo en motor nuevo; ambiguo en legado | `engine.ts`, `seal-pdf`, `vps/signer` | Parcial | Alto | **B/D** Conservar hash final moderno; retirar afirmaciones del sellado visual. |
| 4 | Cadena original | Si | Completo en motor nuevo | `canonical.ts`, `engine.ts` | Si | Medio | **B** Versionar esquema y agregar ambiente/proveedor/algoritmo efectivo. |
| 5 | Cadena de evidencia | Si | Completo con fuente auditora incompleta | `engine.ts`, `evidence_manifests*` | Si | Alto | **B** Alimentar desde ledger canonico de `documentos`. |
| 6 | Firma RSA o ECDSA | Si | Parcial y duplicado | adaptador KMS, VPS, e.firma | Si, adaptador KMS | Critico | **C/D** Unificar por provider; sustituir firmas simuladas y llaves locales. |
| 7 | Custodia de llave privada | Parcial | Inseguro en legado; externa en diseno moderno | `cert_loader.py`, `generate-docubox-cert`, adapters | Solo modelo moderno | Critico | **D** KMS/HSM no exportable, rotacion y attestation. |
| 8 | Certificado X.509 | Si | Parcial/obsoleto | VPS, generador P12, metadatos KMS/TSA | Parcial | Critico | **D/B** Sustituir CA autofirmada; validar cadena y usos de clave. |
| 9 | Firma PDF | Si | Duplicado | `seal-pdf`, VPS pyHanko, PAdES gateway | Si, pyHanko como provider | Alto | **C** Un solo `PdfSignatureProvider`; separar estampa visual de firma PDF. |
| 10 | PAdES | Parcial | Implementado pero no consolidado | VPS y `signPdfWithPades` | Parcial | Alto | **B/C** Adaptar pyHanko o servicio equivalente y revalidar salida localmente. |
| 11 | RFC 3161 | Si | Parcial | VPS TSA, gateway TSA, `timestamp_records` | Si | Alto | **B** HTTPS, trust anchors, nonce, politica y artefactos DER. |
| 12 | Validacion del timestamp | Parcial | Solo respuesta de gateway/estado persistido | `adapters.ts`, `getPublicCertification` | Parcial | Alto | **E/B** Parser/validador independiente que revalide CMS, imprint, tiempo y cadena. |
| 13 | Verificacion de certificados | Parcial | Incompleto | e.firma, VPS, metadatos KMS/TSA | Limitado | Critico | **E** Servicio comun de path building, EKU/KU, vigencia y politicas. |
| 14 | OCSP y CRL | No real | Simulado/no encontrado | `sign-efirma` | No | Critico | **E** Provider con cache, stapling de evidencia y estado indeterminado fail-closed. |
| 15 | Reporte tecnico | Si | Multiple y parcialmente frontend | `engine.ts`, constancias en paginas React, XML | Si, reporte moderno | Alto | **C** Generar solo en backend desde snapshot certificado versionado. |
| 16 | Codigo QR | Si | Completo visualmente, varios destinos | certificacion, constancias, verificacion publica | Si | Medio | **B** Unificar URL, version y estado publico/privado. |
| 17 | Auditoria | Si | Duplicada | multiples tablas y APIs | Parcial | Alto | **C** Ledger legal unico y proyecciones de actividad separadas. |
| 18 | Evidencia de participantes | Si | Parcial | `signature_evidence`, JSON `participantes`, responses | Si | Alto | **C** Snapshot firmado por evento; eliminar confianza en JSON mutable. |
| 19 | Evidencia de OTP | Si | Inseguro | `signature_otps`, `send-otp` | Esquema parcial | Critico | **D** CSPRNG, hash/HMAC, intentos, rate limit, consumo atomico y tabla exclusiva. |
| 20 | Evidencia biometrica | Si | Parcial/simulada en rutas antiguas | enrollment, identity engine, captures | Solo engine nuevo | Critico | **D/B** Desactivar simulacion; provider verificable, consentimiento y retencion. |
| 21 | Integridad de logs | Si | Robusta pero desconectada | `document_integrity_log`, audit trail, transition logs | Parcial | Alto | **C** Migrar FK a agregado canonico y anclar hashes fuera de la BD. |
| 22 | Cifrado de archivos | No en capa aplicativa | No encontrado | buckets privados; comentarios AES | No | Alto | **E** Envelope encryption AES-256-GCM por objeto/tenant con KMS. |
| 23 | Cifrado de campos sensibles | Parcial | Inseguro | enrollment AES-CBC; columnas `*_encrypted` | No | Critico | **D** AEAD con nonce unico, AAD, version y rotacion; no fallback aleatorio. |
| 24 | Gestion de secretos | Parcial | Inseguro en legado | env, Vault, secreto P12 fijo, token VPS | Parcial | Critico | **D/B** Rotar; workload identity, secret manager y escaneo CI. |
| 25 | Multi-tenancy y RLS | Si | Parcial/inconsistente | `workspace_id`, `tenant_id`, RLS | Si | Alto | **C** Helper RBAC unico y pruebas de aislamiento por cada API/RPC/bucket. |
| 26 | Interfaz de configuracion | Si | Solo frontend/estado | visor y generador admin | Parcial | Alto | **C** Consola de salud sin secretos, con readiness firmado y roles admin. |
| 27 | Manejo de fallas | Si | Parcial | `CertificationError`, estados FAILED, catches heredados | Si, moderno | Alto | **B** Transacciones compensatorias, outbox y no ignorar escrituras legales. |
| 28 | Idempotencia | Si | Parcial | `document_certifications`, NOM y colas | Si | Medio | **B** Clave obligatoria, request hash, concurrencia y respuesta reproducible. |
| 29 | Reintentos | Si | Parcial/aislado | NOM-151 y XML queue | Parcial | Alto | **C/E** Worker durable, exponential backoff, jitter, DLQ y alertas. |
| 30 | Trazabilidad completa | Parcial | Fragmentada | certificacion, firma, auditoria, verificacion | Si, piezas | Critico | **C** Correlation ID unico y grafo documento-evento-evidencia-artefacto-provider. |

## 4. Duplicidades y fuente unica de verdad

| Dominio | Duplicidad detectada | Fuente unica propuesta | Tratamiento del legado |
|---|---|---|---|
| Documento | `documents` y `documentos` | `public.documentos` con version inmutable del artefacto | Vista/adaptador de compatibilidad de solo lectura; backfill con mapa de IDs. |
| Hash | Helpers Node, WebCrypto y Deno sin vectores comunes | `IntegrityHasher` con SHA-256 y suite compartida de vectores | Mantener wrappers por runtime, no logica divergente. |
| Canonicalizacion | JCS moderno y cadenas/XML manuales | `canonical.ts` versionado, RFC 8785 probado | Marcar cadenas previas con su `schema_version`; nunca recalcular historia con esquema nuevo. |
| Auditoria | audit trail, integrity log, activity, security y firma | `legal_evidence_events` append-only, hash-chained; `activity_log` como proyeccion | Importar filas preservando tabla/ID/hash original y etiqueta `LEGACY`. |
| Evidencia de firma | `signature_evidence`, `firma_eventos`, JSON y sellos | `signature_evidence` normalizada + artefactos versionados | Congelar tablas antiguas y enlazar sus hashes al manifest. |
| NOM-151 | tablas para `documents` y `documentos`; Edge y API | `nom151_constancias_doc` renombrada/normalizada por adapter PSC | Conservar `.ans` y respuesta original; revalidar antes de elevar confianza. |
| XML | Edge XML manual, API XML y columnas en documento | Paquete de evidencia JSON canonico; XML solo como export interoperable firmado correctamente | Etiquetar XML HMAC como `LEGACY_NOT_XMLDSIG`. |
| PDF | sello visual, VPS y gateway PAdES | `PdfSignatureProvider` + verificador independiente | Conservar PDF visual como artefacto no firmado, sin etiqueta PAdES. |
| Certificado | P12 local, PEM en disco y KMS metadata | KMS/HSM externo; BD solo clave publica, cadena y version | Revocar/retirar certificados locales y publicar lista de artefactos afectados. |
| Constancias | Generadores en cliente, Edge y motor | Renderer backend determinista desde `CertificationSnapshot` | Constancias historicas se conservan con nivel de confianza explicito. |
| Estados | valores en espanol, ingles y JSON participante | Maquina de estados versionada y eventos canonicos | Tabla de traduccion, no reescritura silenciosa. |
| Storage | URL completa, path, signed URL y campos `*_path` | `{bucket, object_key, version_id, sha256, size, encryption}` | Resolver URLs antiguas y reemplazarlas por referencias internas. |

## 5. Arquitectura objetivo por adaptadores

### Capas

1. **Dominio:** `CertificationOrchestrator`, `EvidenceManifestBuilder`, `DocumentStateMachine` y politicas de confianza sin SDKs de proveedores.
2. **Puertos:** interfaces criptograficas, storage, reloj, auditoria, repositorios y validadores.
3. **Adaptadores:** KMS/HSM, TSA/PSC, pyHanko u otro firmador PAdES, Supabase y proveedores de identidad.
4. **Workers:** jobs durables idempotentes para certificacion, reintentos, revocacion y revalidacion.
5. **Presentacion:** UI y portal publico consumen un `VerificationResult`; nunca infieren validez desde la existencia de un archivo.

```ts
interface KeyManagementProvider {
  signDigest(input: SignDigestInput): Promise<SignDigestResult>;
  getPublicKey(keyId: string): Promise<string>;
  getKeyMetadata(keyId: string): Promise<KeyMetadata>;
  healthCheck(): Promise<ProviderHealth>;
}

interface TimestampAuthorityProvider {
  timestamp(input: TimestampInput): Promise<TimestampResult>;
  validate(input: TimestampValidationInput): Promise<TimestampValidationResult>;
  healthCheck(): Promise<ProviderHealth>;
}

interface PdfSignatureProvider {
  sign(input: PdfSignInput): Promise<PdfSignResult>;
  validate(input: PdfValidationInput): Promise<PdfValidationResult>;
  healthCheck(): Promise<ProviderHealth>;
}

interface CertificateValidationProvider {
  validatePath(input: CertificatePathInput): Promise<CertificatePathResult>;
  checkRevocation(input: RevocationInput): Promise<RevocationResult>;
}

interface ArtifactProtectionProvider {
  encrypt(input: EncryptArtifactInput): Promise<EncryptedArtifact>;
  decrypt(input: DecryptArtifactInput): Promise<Uint8Array>;
  rewrap(input: RewrapDekInput): Promise<RewrappedArtifact>;
}

interface LegalEvidenceLedger {
  append(input: AppendEvidenceEventInput): Promise<EvidenceEventReceipt>;
  verify(documentId: string): Promise<LedgerVerificationResult>;
  snapshot(documentId: string): Promise<LedgerSnapshot>;
}
```

### Contratos obligatorios

- Toda operacion recibe `tenantId`, `workspaceId`, `documentId`, `correlationId`, `idempotencyKey`, `schemaVersion` y `environment`.
- KMS firma digests con llaves no exportables; la aplicacion verifica inmediatamente la firma devuelta.
- El provider PAdES devuelve PDF, ByteRange, certificado, perfil efectivo y reporte; un componente distinto revalida la salida.
- El provider TSA devuelve request, response y token DER. La aplicacion revalida CMS, imprint, nonce, `genTime`, cadena y revocacion.
- Ningun `VALID` se construye solo con booleanos enviados por el mismo proveedor que creo el artefacto.
- Fallas criptograficas son fail-closed; indisponibilidad es `INDETERMINATE`/`SERVICE_UNAVAILABLE`, nunca `VALID`.
- La constancia muestra explicitamente `DEVELOPMENT`, `STAGING` o `PRODUCTION`, proveedores, versiones de llave, politicas y validadores.

## 6. Modelo canonico recomendado

- `documentos`: agregado funcional y pertenencia multi-tenant.
- `document_versions`: bytes congelados, hash, size, MIME, storage version y estado.
- `legal_evidence_events`: eventos append-only con secuencia, previous hash, event hash, actor y correlation ID.
- `signature_evidence`: acto de firma normalizado y referencias a artefactos; no valores declarados sin verificacion.
- `document_certifications`: estado del workflow, version e idempotencia.
- `evidence_manifests` y `evidence_manifest_items`: snapshot sellado.
- `cryptographic_keys`: solo material publico y metadata de KMS/HSM.
- `timestamp_records`: artefactos RFC 3161 y resultado de validacion independiente.
- `document_artifacts`: referencia interna, hash, version, cifrado y clasificacion.
- `verification_runs` y `verification_checks`: resultados inmutables, con version de validador.

El `certification_root_sha256` debe enlazar version de documento, manifest, ledger, sellos, timestamp, PAdES y ambiente. La constancia se genera desde ese snapshot, despues se inserta en el PDF y finalmente el PDF se firma con PAdES. Ninguna modificacion ordinaria ocurre despues de la firma final.

## 7. Plan de migracion sin perdida historica

### Fase 0 - Contencion inmediata

- Rotar/eliminar P12 y contrasena fija; inventariar PDFs afectados.
- Deshabilitar afirmaciones PAdES/NOM-151/AES en flujos que no puedan probarlas.
- Bloquear endpoints service-role sin autenticacion/autorizacion.
- Clasificar artefactos anteriores como `LEGACY_UNVERIFIED`, no borrarlos.

### Fase 1 - Identidad del dato y autorizacion

- Declarar `documentos` canonico y crear tabla de correspondencia con `documents`.
- Introducir helper unico RBAC de workspace y aplicarlo a API, RPC, RLS y storage.
- Separar OTP de firma, login y recuperacion; migrar solo metadatos, nunca codigos activos.
- Corregir RLS de sellos, metadata y tablas de certificacion.

### Fase 2 - Proveedores reales

- Implementar los puertos KMS, TSA, PAdES y validacion X.509 con identidad de workload/mTLS.
- Convertir el VPS pyHanko en adaptador endurecido o sustituirlo; eliminar clave PEM sin cifrar.
- Integrar OCSP/CRL con cache y evidencia de respuesta.
- Reemplazar AES-CBC por envelope encryption AES-256-GCM.

### Fase 3 - Ledger y paquete tecnico

- Crear ledger canonico para `documentos` y backfill de eventos historicos.
- Versionar cadenas y manifest; incluir ambiente y provenance.
- Generar constancia y paquete ZIP solo en backend.
- Almacenar objetos por path interno y version, nunca signed URL permanente.

### Fase 4 - Verificacion y corte

- Ejecutar doble escritura temporal, comparar hashes y reconciliar.
- Revalidar lotes historicos sin cambiar sus bytes; guardar un nuevo reporte de verificacion.
- Cambiar lecturas a la fuente canonica y dejar adaptadores legacy de solo lectura.
- Retirar rutas antiguas solo despues de observar cero consumidores y completar rollback probado.

## 8. Criterios de regresion y produccion

1. Vectores oficiales RFC 8785 y SHA-256 identicos en Node, Deno y browser.
2. PAdES validado por pyHanko y al menos un validador independiente; pruebas de modificacion posterior.
3. RFC 3161: token bueno, imprint incorrecto, nonce incorrecto, TSA expirada/revocada y red no disponible.
4. X.509: cadena valida, CA no confiable, EKU incorrecto, vigencia, OCSP revoked/unknown y CRL.
5. e.firma: password incorrecta, cert/key no correspondientes, certificado expirado/revocado y firma verificable del digest exacto.
6. OTP: CSPRNG, hash, limite, expiracion, consumo atomico, concurrencia y no enumeracion.
7. RLS: matriz owner/member/participant/admin/anon para cada tabla, bucket, RPC y API service-role.
8. Cifrado: AEAD tampering, rotacion/rewrap, restauracion y perdida controlada de KMS.
9. Idempotencia: solicitudes concurrentes y reanudacion despues de cada punto de falla.
10. Auditoria: secuencia, hash chain, Merkle/root, intento de UPDATE/DELETE y export verificable.
11. Observabilidad: correlation ID de extremo a extremo, metricas, alertas y redaccion de PII/secretos.
12. Disaster recovery: restaurar BD y objetos preservando versiones, hashes y verificabilidad.

## 9. Decision inmediata recomendada

El siguiente incremento no debe crear otro motor. Debe endurecer y conectar el existente en este orden: autorizacion critica, rotacion de secretos, consolidacion `documentos`, ledger legal, providers KMS/TSA/PAdES reales, validacion independiente y cifrado AEAD. Solo despues debe habilitarse la emision de constancias con estado `VALID`; mientras tanto la UI debe mostrar `Configuracion pendiente`, `Registrado` o `No verificado` segun corresponda.
