# WP-NOM151-PRODUCTION-TRUST

Fecha de validacion: 2026-08-29 UTC

## Resultado

`NOM151_PROVIDER_NOT_PRODUCTION`

La evidencia NOM-151 existente supera la verificacion criptografica, la cadena
X.509 y el trust root configurado. No se promueve a produccion porque la cuenta y
el entorno contractual de Nubarium no han sido confirmados/configurados como
productivos. El entorno local queda declarado como `development` y la evidencia
persistida mantiene `production_trusted=false`.

## 1. Endpoint y entorno detectado

- Endpoint: `https://firma.nubarium.com/nom151/v1/obtener-nom151`.
- Host persistido: `firma.nubarium.com`.
- Entorno configurado: `development` mediante `NOM151_ENVIRONMENT`.
- Credenciales backend detectadas: si. No se imprimieron ni persistieron.
- `production` exige adicionalmente `NOM151_PRODUCTION_ENDPOINT` identico al
  endpoint activo y toda la configuracion de trust.

## 2. Estado productivo real

- Verificacion tecnica: `verified`.
- Trust de produccion: `false`.
- Estado agregado: `development`.
- La UI muestra `NOM-151 no productiva`; nunca infiere produccion por la mera
  existencia de una constancia.

## 3. Certificado firmante

- Organizacion: `PSC World S.A. de C.V.`.
- CN: `Autoridad de Constancias de Conservacion de mensajes de datos de PSC WORLD`.
- Serial: `011D`.
- SHA-256: `93762cb9e8a296adbf4fbf0689b27c37f6c33f746d62479a267d005251a2afaa`.
- Vigencia: `2026-02-10T00:00:00Z` a `2031-02-10T00:00:00Z`.
- Basic Constraints: `CA=false`.
- Key Usage comprobado: `digitalSignature`, `contentCommitment`,
  `keyEncipherment`, `keyAgreement`.
- Extended Key Usage observado y comprobado: `1.3.6.1.5.5.7.3.4`
  (emailProtection) y `1.3.6.1.5.5.7.3.2` (clientAuth).
- Certificate Policy: `2.16.484.101.10.316.10.1`.
- TST Policy: `2.16.484.101.10.316.100.2.1.2.1.1`.

Estas propiedades se validan contra el manifest versionado. No se agregaron EKU
supuestos que no aparezcan en el certificado real.

## 4. Intermediates

No se observo un certificado intermedio en la respuesta real. La hoja encadena
directamente a ACR2-SE. El loader soporta intermediates configurados para futuras
rotaciones mediante `NOM151_PSC_TRUST_INTERMEDIATES_PATH`.

## 5. Root CA

- Root: `Autoridad Certificadora Raiz Segunda de Secretaria de Economia`.
- Organizacion: `Secretaria de Economia`.
- Serial: `01`.
- Vigencia: `2017-02-08T00:00:00Z` a `2032-02-08T00:00:00Z`.
- SHA-256: `b2f258c42c3066c54c3d9bbcb9a4c16bed4e7b74f302643a11af26961e09c720`.
- Fuente oficial: [Directorio de PSC](https://psc.economia.gob.mx/directorio.html)
  y [certificado ACR2-SE](https://psc.economia.gob.mx/certificados/ACR2_SE.cer).
- Manifest activo: `psc-world-acr2-se-v1`, version `1`.

La raiz se incorpora mediante onboarding explicito y pin SHA-256. El runtime no
descarga ni confia dinamicamente en certificados recibidos durante la emision.

## 6. Fingerprints persistidos

- Hoja PSC World: `93762cb9e8a296adbf4fbf0689b27c37f6c33f746d62479a267d005251a2afaa`.
- Root ACR2-SE: `b2f258c42c3066c54c3d9bbcb9a4c16bed4e7b74f302643a11af26961e09c720`.
- `chain_fingerprints` contiene ambos valores.

## 7. CMS

`cms_signature_valid=true`. La firma CMS se valida sobre el token original; una
alteracion del ASN.1 produce fallo.

## 8. Digest binding

- SHA-256 PDF PAdES-B-T: `cc46ee98316fa891a89bb4fc8fd3e71eba8956a92e7df8064cc0df6abbfba2a8`.
- `digest_binding_valid=true`.
- Una alteracion de un byte del PDF invalida el enlace.

## 9. Cadena

`chain_status=valid`. Se valida:

`PSC World leaf -> ACR2-SE configured trusted root`

La fecha de comprobacion de cadena es `genTime`, no solo la hora actual.

## 10. Trust

- `root_trusted=true`.
- `certificate_profile_valid=true`.
- `tst_policy_valid=true`.
- `trust_bundle_version=1`.
- `production_trusted=false`, debido exclusivamente al entorno no productivo.

## 11. E2E

- Documento: `0231221c-aa64-48d0-a90c-bfb52167c6f9`.
- Version: `1d0fa992-dfee-4d3c-9a5a-0bf380cafd4a`.
- Certificacion PAdES-B-T: `84365f2f-eb9f-4a3a-9f94-1c48910da1d8`.
- Registro NOM-151: `e73bd0fb-d91e-4f9b-97a8-1ce3e3277f50`.
- Operation ID: `dg1787973151.178191.144`.
- Folio: `69bc95ca34de`.
- SHA-256 constancia original: `250cafcf37eb22ccf894d673faafd9533f86e417cf06c6248cc21a46cb303b1e`.
- Resultado permitido: `NOM151_PROVIDER_NOT_PRODUCTION`.
- Idempotencia: PASS; no se solicito un nuevo folio.

## 12. Controles negativos y regresion

- Root pin distinto: rechazado con `NOM151_UNTRUSTED_ROOT`.
- Produccion sin endpoint esperado exacto: rechazado con
  `NOM151_PROVIDER_ENVIRONMENT_MISMATCH`.
- Valor de entorno invalido o legacy: nunca se considera produccion explicita.
- PDF alterado: FAIL.
- ASN.1 alterado: FAIL.
- CMS/digest/certificado/cadena/policy: fail-closed con codigos especificos.
- Health check: no ejecuta llamadas de emision ni consume folios.
- TypeScript: PASS.
- Build Next.js: PASS.
- Pruebas KMS/X.509/PAdES/TSA/NOM-151/UI: 68/68 PASS.
- E2E NOM-151 real: PASS tecnico.
- ESLint dirigido: PASS, 0 errores y 0 warnings.

## 13. Pendientes externos

Para obtener `REAL DOCUMENT NOM151 VERIFIED` se requiere confirmacion contractual
del perfil productivo de las credenciales y endpoint de Nubarium, seguida de la
configuracion backend explicita:

```text
NOM151_ENVIRONMENT=production
NOM151_PRODUCTION_ENDPOINT=<endpoint productivo confirmado>
NOM151_NUBARIUM_ENDPOINT=<mismo endpoint productivo confirmado>
```

No se debe cambiar a `production` solo para obtener un PASS. Una vez confirmada la
cuenta productiva, debe ejecutarse nuevamente el E2E sin regenerar constancias
historicas. La revocacion en linea OCSP/CRL no formo parte de este WP y debe
definirse contractualmente antes del rollout productivo si el PSC la exige.

## Archivos principales

- `src/lib/nom151/trust.ts`
- `src/lib/nom151/provider.ts`
- `src/lib/nom151/service.ts`
- `infra/nom151/trust/manifest.json`
- `infra/nom151/trust/roots/ACR2_SE.pem`
- `scripts/onboard-nom151-psc-trust.ts`
- `src/app/api/internal/crypto/nom151-health/route.ts`
- `supabase/migrations/20260829051444_nom151_production_trust.sql`
- `tests/nom151-production-trust.test.mjs`
