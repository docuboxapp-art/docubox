# Contrato de verificacion de e.firma local

## Objetivo

La llave privada SAT y su contrasena permanecen en el navegador. El gateway recibe solamente el
certificado publico, el contenido firmado y la firma RSA generada por el usuario.

## Solicitud

`POST DOCUBOX_EFIRMA_GATEWAY_URL`

```json
{
  "operation": "VERIFY_EFIRMA",
  "certificate_der_base64": "...",
  "signature_base64": "...",
  "signature_algorithm": "RSA-SHA256",
  "payload_utf8_base64": "...",
  "payload_sha256": "...",
  "correlation_id": "uuid"
}
```

El gateway debe:

1. Verificar que `payload_sha256` corresponde exactamente a `payload_utf8_base64`.
2. Verificar la firma RSA-SHA256 con la llave publica del certificado.
3. Validar la cadena del certificado contra anclas SAT confiables.
4. Consultar revocacion y vigencia en una fuente confiable, sin aceptar estado indeterminado.
5. Extraer los datos del certificado directamente del DER recibido.

## Respuesta satisfactoria

```json
{
  "status": "VALID",
  "signature_verified": true,
  "certificate_chain_valid": true,
  "revocation_status": "GOOD",
  "payload_sha256": "...",
  "signature_algorithm": "RSA-SHA256",
  "signature_id": "provider-reference",
  "provider": "provider-name",
  "revocation_checked_at": "2026-09-21T00:00:00.000Z",
  "certificate": {
    "serial_number": "...",
    "subject": "...",
    "issuer": "...",
    "rfc": "...",
    "curp": "...",
    "not_before": "...",
    "not_after": "...",
    "fingerprint_sha256": "..."
  }
}
```

Docubox rechaza la operacion si cualquiera de las validaciones obligatorias no es positiva. El
gateway no debe solicitar, registrar ni aceptar `encrypted_private_key_base64`, `key_b64`,
`private_key_password` o `password` para esta operacion.
