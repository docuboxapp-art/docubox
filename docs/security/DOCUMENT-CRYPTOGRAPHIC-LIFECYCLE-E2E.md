# Docubox Cryptographic Lifecycle E2E

Fecha: 2026-08-30

## Alcance verificado

La base de cifrado documental está verificada contra Supabase Storage y Google
Cloud KMS HSM:

`DOCUMENT ENCRYPTION PRODUCTION E2E VERIFIED`

Se comprobaron AES-256-GCM, AAD tenant/document/version/artifact, wrapped DEK,
Storage privado, objeto que no inicia con `%PDF-`, descifrado autorizado,
igualdad SHA-256 y rechazo de ciphertext, nonce, AAD, wrapped DEK y recurso KMS
alterados.

## Cadena completa

La cadena `ENCRYPT -> STORAGE -> DECRYPT` pasó sobre infraestructura real. La
continuación `PAdES -> nueva versión -> cifrado -> TSA -> NOM-151 -> constancias`
no se ejecutó en esta sesión porque requiere acceso operativo autenticado a los
secretos productivos de Vercel y a un documento E2E creado mediante el flujo
normal, sin copiar esos secretos al repositorio o al entorno local.

Por tanto, no se afirma:

- `PADES PRODUCTION E2E VERIFIED`;
- `TSA RFC3161 PRODUCTION E2E VERIFIED`;
- `NOM-151 DOCUMENT ENCRYPTION E2E VERIFIED`;
- `DOCUBOX CRYPTOGRAPHIC DOCUMENT LIFECYCLE E2E PASS`;
- `PRODUCTION_VERIFIED`.

## Resultado

`DOCUMENT ENCRYPTION BASE: PASS`

`FULL CRYPTOGRAPHIC LIFECYCLE: FAIL` (gates posteriores no ejecutados)

`FAIL-CLOSED LIFECYCLE: PASS` para el límite de cifrado y descifrado probado.

El siguiente ejecutor debe correr los scripts productivos desde un entorno con
WIF/secret manager operativo, sobre un documento artificial nuevo y autenticado,
y registrar cada versión y artefacto antes de cambiar el estado global.
