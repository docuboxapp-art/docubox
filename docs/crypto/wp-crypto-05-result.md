# WP-CRYPTO-05 - PAdES Engine result

## Result

**PASS - PAdES-B-B verificable implementado.** El motor de certificacion ya no
acepta una afirmacion de un gateway como prueba de firma PDF. Prepara un campo
de firma PDF, fija el `ByteRange`, construye un CMS detached, solicita la firma
al `KeyManagementProvider`, incorpora el certificado X.509 y verifica el PDF
antes de promover el estado a `valid`.

## Delivered

- `src/lib/certification/pades.ts` define `PdfSignatureProvider` y la
  implementacion `PadesBbPdfSignatureProvider`.
- El flujo implementa PDF placeholder, `ByteRange`, CMS/PKCS#7 detached,
  RSA-PSS/SHA-256 mediante `KeyManagementProvider.signDigest`, certificado
  X.509 embebido y verificacion de CMS, digest, certificado y rango de bytes.
- `src/lib/certification/engine.ts` usa exclusivamente el limite del proveedor
  para PAdES-B-B. No solicita una TSA, no declara PAdES-B-T y registra la TSA
  como `not_configured` hasta WP-CRYPTO-06.
- `src/lib/certification/adapters.ts` conserva el adaptador de gateway solo
  como referencia de compatibilidad, pero queda bloqueado para nuevos flujos;
  una respuesta remota sin verificacion ya no puede crear un resultado PAdES.
- `supabase/migrations/20260821200622_wp_crypto_05_pades_engine.sql` agrega,
  sin destruir datos, los campos tecnicos a `document_certifications` y la
  tabla privada `document_pdf_signatures`.

## Evidence persisted

Se conservan el perfil, algoritmo de firma y digest, numero de serie y huella
del certificado, `ByteRange`, hash CMS, hash del PDF final, hora declarada de
firma y el resultado completo de verificacion. El CMS, certificado y reporte
permanecen como artefactos privados de la certificacion. No se persisten llaves
privadas, PIN, tokens de OpenBao ni secretos.

## Library selection

- `@signpdf/placeholder-pdf-lib` (MIT) reserva un campo de firma y el espacio
  necesario para el CMS sin reconstruir el renderer visual existente.
- `pkijs` y `asn1js` (BSD-3-Clause) construyen y validan CMS/PKCS#7 con
  primitivas ASN.1 mantenidas. La firma se resuelve de forma remota mediante
  `KeyManagementProvider`; no se implementa ASN.1 ni CMS a mano ni se exporta
  una llave privada.

## Truthful states

- Una firma PDF solo queda `valid` despues de que `verifyPdf()` confirme
  ByteRange, CMS y certificado.
- Un certificado invalido, vencido o no ligado a la llave administrada detiene
  el proceso con `PADES_CERTIFICATE_INVALID`.
- Sin TSA el perfil es estrictamente `PAdES-B-B`; RFC 3161, PAdES-B-T y
  NOM-151 siguen como capacidades no configuradas.
- Si el motor se deshabilita o falla la verificacion, el flujo no declara una
  firma criptografica valida.

## Verification

- `npm.cmd run type-check`
- `node --test tests\pades-provider.test.mjs`
- Las pruebas generan una llave temporal solo para simular el proveedor
  remoto. Comprueban que el CMS detached se valida de forma independiente con
  OpenSSL en modo binario, rechazan una mutacion posterior del PDF y bloquean
  un certificado no valido.

## Activation

Aplicar la migracion, completar WP-CRYPTO-03 (OpenBao) y WP-CRYPTO-04
(certificado X.509) es requisito para activar este camino en un entorno real.
Mientras falte cualquiera de esas capas, el motor falla cerrado y la
certificacion permanece en modo fundacional.
