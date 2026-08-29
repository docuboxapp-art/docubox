# Portable GCP Workload Identity Auth - Resultado

Fecha de ejecucion: 2026-08-29

## Estado

**PORTABLE GCP WORKLOAD IDENTITY AUTH READY**

**VERCEL PRODUCTION GCP WIF VERIFIED**

**VERCEL PRODUCTION CRYPTO E2E VERIFIED**

**VERCEL PREVIEW PRODUCTION HSM DENIED**

La autenticacion de Google Cloud esta separada del hosting. El proveedor KMS
recibe un `GoogleCloudAuthProvider` y no contiene decisiones de Vercel, AWS,
Azure ni Google Cloud runtime.

## WIF productivo

- Pool: `docubox-vercel`.
- Provider: `vercel`.
- Issuer: `https://oidc.vercel.com/docubox`.
- La condicion permite exclusivamente el sujeto del proyecto `docubox` en
  `environment:production`.
- La Service Account autorizada es
  `docubox-pades-prod-signer@project-702d9de4-d29c-49f2-82c.iam.gserviceaccount.com`.
- El intercambio ejecutado fue Vercel OIDC -> Google STS -> WIF -> Service
  Account -> Google Cloud HSM.
- No se permitio fallback a ADC local y no se usaron archivos JSON de Service
  Account.

La prueba KMS desde Vercel Production acredito:

- `GCP_AUTH_MODE=workload_identity`;
- proveedor `google-cloud-kms`;
- protection level `HSM`;
- algoritmo `RSA-PKCS1-SHA256` sobre llave RSA 3072;
- key version `1`;
- `getPublicKey`: PASS;
- `asymmetricSign`: PASS;
- `crypto.verify`: `true`.

El mismo endpoint desplegado como Preview recibio `403
GOOGLE_WIF_ACCESS_DENIED`. La politica de Google rechazo el sujeto Preview y no
se intento ADC local.

## Documento real

El E2E creo en Vercel Production un documento tecnico aislado y lo proceso por
la ruta autenticada existente `POST /api/documentos/{id}/seal-signatures`.

- Documento: `5cada7dd-5713-4c9f-bb46-359d97b15e35`.
- Certificacion: `1bc3d1c5-9112-4373-8fe1-8e94e16fb80f`.
- Perfil: `PAdES-B-T`.
- Integridad, certificado, timestamp y verificacion: `valid`.
- KMS: `gcp`, protection level `hsm`, key version `1`.
- Vinculo certificado/SPKI: valido.
- Verificacion primaria: PASS.
- Verificacion independiente: PASS.
- TSA: FreeTSA, rol `PRIMARY`, trust bundle `freetsa-v1`.
- NOM-151: `NOM151_PROVIDER_NOT_PRODUCTION`.

No se modificaron CMS, X.509, PAdES, TSA ni NOM-151. La firma y el timestamp
fueron producidos por los motores existentes y la certificacion solo se marco
valida despues de sus verificadores.

## Visor autenticado

Se abrio `/visor-documento/5cada7dd-5713-4c9f-bb46-359d97b15e35` con una sesion
real del propietario, sin desactivar Auth ni RLS. La tarjeta de descargas mostro
desde evidencia persistida:

- `PAdES-B-T - Verificado`;
- Google Cloud HSM y protection level HSM;
- RSA 3072 / SHA-256;
- certificado X.509 y vinculo SPKI validos;
- sello RFC 3161 verificado;
- FreeTSA, serial, policy OID y confianza validos;
- NOM-151 no configurada, sin presentarla como productiva.

No se mostraron tokens, credenciales, private keys ni authorization headers en
la aplicacion. Al terminar, `VERCEL_CRYPTO_E2E_ENABLED` se cambio a `false` y el
endpoint de prueba quedo cerrado con `404 VERCEL_CRYPTO_E2E_DISABLED`.

## Arquitectura portable

- Modos: `local_adc`, `workload_identity` y `gcp_native`.
- `GoogleCloudAuthProvider.getAuthClient()` entrega la autenticacion al SDK de
  Cloud KMS.
- `WorkloadSubjectTokenProvider` separa la obtencion del subject token del
  intercambio STS.
- Vercel vive en `VercelOidcSubjectTokenProvider` detras de esa interfaz.
- AWS, Azure y OIDC generico conservan puntos de extension sin cambios en KMS,
  CMS, X.509, PAdES, TSA o NOM-151.
- En produccion se rechazan credenciales permanentes y los modos incompletos
  fallan cerrados.

## Verificacion

- autenticacion portable y KMS: 14/14 PASS;
- suite completa: 117/117 PASS;
- `npm run type-check`: PASS;
- build local y build Vercel Production: PASS;
- ESLint dirigido al endpoint E2E: PASS.
