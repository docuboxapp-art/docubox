# Motor de certificacion criptografica

Este modulo genera una constancia visual, un PDF final PAdES y un paquete tecnico verificable para documentos completados. La aplicacion no contiene, recibe ni persiste llaves privadas.

## Flujo

1. Congelar y recuperar los bytes del documento completado.
2. Calcular SHA-256 del cuerpo documental.
3. Construir cadenas deterministas mediante JCS (RFC 8785) y normalizacion NFC.
4. Sellar por separado la cadena documental y la cadena de evidencias con RSA-PSS-SHA256 y llaves RSA de al menos 3072 bits administradas por KMS/HSM.
5. Solicitar y validar una estampa RFC 3161 sobre el hash canonico del paquete.
6. Crear la constancia visual y anexarla al documento.
7. Firmar el PDF resultante mediante PAdES, validando `ByteRange`.
8. Guardar artefactos privados, hashes, transiciones de estado y accesos.

Los estados y registros viven en la migracion `supabase/migrations/20260805010000_cryptographic_certification_engine.sql`. El bucket `certification-artifacts` es privado.

## Configuracion

La aplicacion solo habla con gateways internos autenticados:

```env
DOCUBOX_KMS_GATEWAY_URL=https://crypto.internal.example/kms
DOCUBOX_TSA_GATEWAY_URL=https://crypto.internal.example/tsa
DOCUBOX_PADES_GATEWAY_URL=https://crypto.internal.example/pades
DOCUBOX_CRYPTO_GATEWAY_TOKEN=token-de-servicio
```

No se deben agregar llaves privadas, archivos PKCS#12 ni contrasenas de certificados a variables de entorno, Supabase, codigo o logs.

## Contrato KMS

`POST {DOCUBOX_KMS_GATEWAY_URL}/sign`

```json
{
  "purpose": "DOCUMENT_SEAL",
  "algorithm": "RSA-PSS-SHA256",
  "digest_base64": "...",
  "canonical_payload_base64": "..."
}
```

`purpose` tambien puede ser `EVIDENCE_SEAL`. La respuesta debe incluir `signature_base64`, `signature_sha256`, `key_id`, `key_version`, `algorithm`, `key_size`, `public_key_pem` y `public_key_fingerprint_sha256`. Docubox rechaza algoritmos distintos, llaves menores de 3072 bits o firmas que no validen localmente.

## Contrato TSA

`POST {DOCUBOX_TSA_GATEWAY_URL}/timestamp`

```json
{
  "hash_algorithm": "SHA-256",
  "message_imprint_sha256": "...",
  "cert_req": true
}
```

La respuesta debe incluir el token RFC 3161, respuesta TSR, fecha de generacion, politica, serie, datos del certificado TSA y estas validaciones en `true`: `message_imprint_match`, `token_signature_valid`, `certificate_chain_valid`, `certificate_time_valid` y `policy_valid`.

## Contrato PAdES

`POST {DOCUBOX_PADES_GATEWAY_URL}/sign`

```json
{
  "profile": "PAdES-B-LT",
  "digest_algorithm": "SHA-256",
  "pdf_base64": "..."
}
```

La respuesta debe contener `signed_pdf_base64`, `signature_valid: true`, `byte_range_valid: true` y el perfil aplicado. El motor rechaza respuestas sin esas validaciones.

## Operacion

- Aplicar la migracion antes de habilitar el boton de generacion.
- Configurar dos alias o llaves KMS independientes para documento y evidencia.
- Rotar llaves por version; conservar sus claves publicas y metadatos historicos.
- Mantener TSA, KMS y PAdES en una red privada con autenticacion de servicio y listas de acceso.
- Respaldar el bucket privado y las tablas append-only conforme a la politica de retencion.
- Ante cualquier fallo, la certificacion queda `FAILED`; nunca se emiten hashes, firmas o estampas simuladas.

La verificacion publica recalcula el documento, el PDF certificado, el manifiesto, las cadenas, los sellos, el token, el `messageImprint`, la raiz y el enlace final de auditoria. Solo devuelve `VALID` cuando todos coinciden.
