# WP-PRODUCTION-HSM-X509-PADES - Resultado

Fecha de ejecucion: 2026-08-29

## Estado

**PASS para HSM, X.509, PAdES-B-B y PAdES-B-T.**

- `PRODUCTION HSM KMS E2E VERIFIED`
- `PRODUCTION PADES-B-B VERIFIED`
- `PRODUCTION PADES-B-T VERIFIED`

NOM-151 permanece correctamente separado como
`NOM151_PROVIDER_NOT_PRODUCTION`. No se emite el marcador
`REAL DOCUMENT NOM151 VERIFIED`.

## 1. Google Cloud HSM

ADC detectada:

`docubox-pades-prod-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com`

Resource validado:

`projects/project-702d9de4-d29c-49f2-82c/locations/us-east1/keyRings/docubox-pades-prod/cryptoKeys/docubox-pades-production-signing/cryptoKeyVersions/1`

Resultado real:

- `getPublicKey`: PASS.
- `protectionLevel`: `HSM`.
- algoritmo Google: `RSA_SIGN_PKCS1_3072_SHA256`.
- version: `1`.
- `asymmetricSign`: PASS.
- verificacion local RSA PKCS#1 v1.5 / SHA-256: `true`.
- fingerprint publico SHA-256 persistido:
  `37287d15f27040eacd731e35739e125ed2209c644e65096233b8d1fbc9f10b92`.

No se creo, exporto ni almaceno una private key.

## 2. X.509 productivo

Se genero un certificado de confianza privada firmado exclusivamente por la
llave HSM mediante `KeyManagementProvider.signDigest()`.

Subject tecnico:

`CN=Docubox Production Document Signing, O=Docubox, OU=Production Trust Services, C=MX`

La razon social productiva de Docubox no esta configurada en el repositorio ni
en el workspace activo; por ello el certificado no atribuye una identidad
fiscal o razon social no comprobada.

Evidencia:

- serial: `6A81D894E7956C096CF2EA8DD9A77CFE`.
- vigencia: `2026-08-29T08:21:49Z` a `2027-08-29T08:26:49Z`.
- fingerprint X.509 SHA-256:
  `cc8af6b4aa2da6300c09c2a99fba98726103a2af67417e7b5f4a588a5adbad86`.
- cadena privada OpenSSL: PASS.
- `SPKI(HSM) == SPKI(X509 production)`: PASS.
- fingerprint SPKI DER persistido en ambos lados:
  `37287d15f27040eacd731e35739e125ed2209c644e65096233b8d1fbc9f10b92`.

El certificado publico local esta fuera de Git en:

`.docubox/crypto/production/google-cloud-hsm-production-signing.crt.pem`

## 3. Documento real

Se creo un documento nuevo en el flujo de producto y se almaceno su PDF visual
en el bucket privado `documents` antes de certificarlo.

- documento: `fef0931b-bdc9-4a80-b359-0e8df6cd4198`.
- folio: `DBX-PRD-MTE4D4FK`.
- version: `efa14fc0-08dd-4fdd-9002-cf32497f651f`.
- certificacion: `58600055-c60a-46c5-8fab-7e5ea940b39c`.
- registro de certificacion: `cc0f278f-e345-46ff-9c6e-730b5bd742f1`.
- SHA-256 PDF visual:
  `faebf9b9feb3248e03ac431bff85059951a059818ce254942548372ec1e20bd8`.

La version visual quedo congelada y se conserva separada de los artefactos
PAdES.

## 4. PAdES-B-B

Flujo ejecutado:

`PDF visual -> ByteRange -> CMS -> Google Cloud HSM -> X.509 production -> verificacion -> Storage -> promocion`

Resultado:

- perfil: `PAdES-B-B`.
- SHA-256 final:
  `6f02a423e48a9fbf57b134505ba0ee16d1bcb38a91ce9215cda012a401070b4d`.
- ByteRange: `[0, 29877, 53879, 1237]`.
- CMS SHA-256:
  `6de90bfcb03112c7794253850d07d6b78aea1ddeba929883eeaa6404431d0dab`.
- verificacion interna: PASS.
- verificacion independiente Docubox: PASS.
- OpenSSL CMS: PASS.
- mutacion de un byte del PDF: FAIL esperado.
- promocion a PDF definitivo solo despues de verificar: PASS.
- retry idempotente y una certificacion por version: PASS.

## 5. PAdES-B-T y RFC 3161

El mismo PAdES-B-B se extendio sin volver a firmar el documento.

- perfil final: `PAdES-B-T`.
- SHA-256 final:
  `f3e036cb3cad24e0f32c7552a9a3e6b99c6688f85507197428024be560995829`.
- proveedor: `freetsa`.
- rol: `PRIMARY`.
- fallback: `false`.
- bundle de confianza: `freetsa-v1`.
- policy OID: `1.2.3.4.1`.
- serial RFC 3161: `075899F3`.
- `genTime`: `2026-08-29T08:31:43Z`.
- token SHA-256:
  `73f86d9099bc52d051f6400cc870791981fd91ea033d6547ad0bd9f565ee1f77`.
- certificado TSA SHA-256:
  `32e841a95cc1164101ffde41298ef2fc75c1c4372ef095e88a6bbd47dfb191fc`.
- nonce, message imprint, policy, CMS, certificado, cadena y EKU: PASS.
- verificacion interna e independiente: PASS.
- OpenSSL CMS y RFC 3161: PASS.
- retry idempotente: PASS.

La regresion externa tambien se ejecuto con dos documentos aislados:

- FreeTSA real como PRIMARY: PASS.
- caida controlada de FreeTSA: detectada como `TSA_HTTP_ERROR`.
- OpenTSA real como FALLBACK: PASS.
- CMS, RFC 3161, confianza y OpenSSL en ambas rutas: PASS.

## 6. Persistencia y Storage

`document_certifications` contiene:

- `environment=production`.
- `kms.provider=gcp`.
- `kms.protection_level=hsm`.
- resource y version `1`.
- fingerprints de llave y certificado.
- binding SPKI valido.
- resultados primario e independiente PAdES-B-T validos.
- procedencia TSA completa.

`cryptographic_keys` contiene material exclusivamente publico:

- `protection_level=hardware`.
- `certificate_environment=PRODUCTION`.
- `certificate_chain_status=valid`.
- fingerprints SPKI/X.509.
- resource KMS en metadata backend.

`timestamp_records` contiene `.tsq`, `.tsr`, `.tst`, nonce, imprint, policy,
serial, `gen_time`, fingerprints, bundle y rol PRIMARY. Los PDFs visual,
PAdES-B-B y PAdES-B-T se conservan en rutas inmutables distintas.

## 7. UI

La tarjeta de `/visor-documento/[id]` deriva `PAdES VERIFICADO` solo cuando
persisten firma, certificado y verificacion validos. Muestra `Google Cloud HSM`
unicamente cuando `provider=gcp` y `protection_level=hsm` vienen de evidencia
persistida. Tambien muestra PAdES-B-T, version, algoritmo, certificado, huellas
y procedencia TSA; no expone el resource KMS completo.

La comprobacion visual autenticada no se ejecuto porque el navegador local
redirigio a `/login`; la derivacion de estado, el build y la persistencia real
si fueron verificados.

## 8. NOM-151

No se modifico el motor NOM-151. El nuevo PDF PAdES-B-T se uso como artefacto
objetivo y produjo:

- `NOM151_PROVIDER_NOT_PRODUCTION`.
- environment: `development`.
- `production_trusted=false`.
- digest binding: PASS.
- firma CMS del artefacto: PASS.
- certificado, perfil y cadena: PASS.
- PDF alterado y artefacto alterado: rechazados.
- revalidacion e idempotencia: PASS.
- registro: `7d9536e8-d1d0-4555-a5cf-564466a4b4b7`.

No se marca `REAL DOCUMENT NOM151 VERIFIED` hasta disponer de Nubarium
production real.

## 9. Negativas

- resource incorrecto: FAIL real (`GOOGLE_KMS_PERMISSION_DENIED`).
- version `999`: FAIL real (`GOOGLE_KMS_KEY_NOT_FOUND`).
- llave Software en produccion: `PRODUCTION_HSM_REQUIRED` en prueba de contrato;
  la cuenta productiva tampoco tiene acceso al resource development.
- X.509 development contra HSM: `CERTIFICATE_KEY_MISMATCH` real por SPKI.
- PDF alterado: FAIL.
- CMS documental alterado: FAIL en OpenSSL.
- respuesta RFC 3161 alterada: FAIL en OpenSSL.
- nonce, imprint, policy, certificado, cadena o token TSA invalidos: fail closed
  en las pruebas del router.

## 10. Regresion

- `npm run type-check`: PASS.
- `npm run build`: PASS.
- HSM E2E real: PASS.
- X.509/OpenSSL/SPKI: PASS.
- PAdES-B-B real e independiente: PASS.
- PAdES-B-T/FreeTSA/OpenTSA/OpenSSL real: PASS.
- compatibilidad NOM-151: PASS con estado no productivo.
- 57 pruebas dirigidas X.509/KMS/PAdES/TSA/produccion/NOM-151: PASS.
- 10 pruebas KMS/OpenBao adicionales: PASS.
- suite completa: 104 PASS y 2 FAIL en expectativas textuales preexistentes de
  `tests/signature-stamp-placement.test.mjs`; el comportamiento NOM-151 real
  del documento productivo si paso su prueba de compatibilidad.
- ESLint semantico dirigido: la capa criptografica no introduce errores; hay
  warnings de scripts y deuda historica de React hooks en
  `visor-documento/[id]/page.tsx`.
- ESLint con Prettier activo sigue fallando por el desajuste historico LF/CRLF
  y formato global; no se aplico un reformateo masivo.

## Resultado final

`PRODUCTION HSM KMS E2E VERIFIED`

`PRODUCTION PADES-B-B VERIFIED`

`PRODUCTION PADES-B-T VERIFIED`
