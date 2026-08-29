# Autenticacion portable de Google Cloud

## Frontera

`GoogleCloudKmsProvider` no obtiene tokens ni detecta el hosting. Consume un
`GoogleCloudAuthProvider`, recibe un `AuthClient` temporal y lo inyecta al SDK
oficial de Cloud KMS.

```text
Hosting identity
  -> WorkloadSubjectTokenProvider
  -> GoogleCloudAuthProvider
  -> Google Workload Identity Federation
  -> Service Account impersonation
  -> AuthClient
  -> GoogleCloudKmsProvider
  -> Google Cloud HSM
```

Esta frontera no modifica `KeyManagementProvider`, CMS, X.509, PAdES, TSA ni
NOM-151.

## Modos

| `GCP_AUTH_MODE` | Uso | Credencial |
| --- | --- | --- |
| `local_adc` | desarrollo y pruebas operativas locales | ADC local, preferentemente impersonada |
| `workload_identity` | Vercel, AWS, Azure u otro hosting externo | subject token temporal + WIF |
| `gcp_native` | Cloud Run, GKE, Compute u otro runtime GCP | identidad nativa mediante ADC |

En un runtime con `NODE_ENV=production`, el modo es obligatorio y se rechazan
`GOOGLE_APPLICATION_CREDENTIALS`, JSON de Service Account y variables de llave
privada. `gcp_native` comprueba que el runtime sea realmente Google Cloud; no
acepta una ADC local como sustituto. No existe fallback silencioso entre modos.

## Workload Identity

Variables obligatorias:

```text
GCP_AUTH_MODE=workload_identity
GCP_PROJECT_ID=<project-id>
GCP_SERVICE_ACCOUNT_EMAIL=<service-account>
GCP_WORKLOAD_IDENTITY_POOL_ID=<pool-id>
GCP_WORKLOAD_IDENTITY_PROVIDER_ID=<provider-id>
GCP_WIF_AUDIENCE=//iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool-id>/providers/<provider-id>
HOSTING_PROVIDER=vercel
```

`GCP_WIF_AUDIENCE` usa el numero de proyecto, no su nombre. El pool y provider
de la audiencia deben coincidir exactamente con las variables separadas.

Para Vercel, `VercelOidcSubjectTokenProvider` usa `@vercel/oidc`, que obtiene el
token del contexto de la Function o de `VERCEL_OIDC_TOKEN` durante build y
desarrollo. El token no se registra ni se persiste.

AWS, Azure y OIDC generico comparten `WorkloadSubjectTokenProvider`. Sus
resolutores se inyectan en la capa de autenticacion; no requieren cambios en
KMS ni en los motores criptograficos. Si el hosting no tiene una implementacion
disponible, la construccion falla cerrada.

## Operacion

- Configurar WIF para aceptar exclusivamente issuer, audience y claims del
  proyecto y entorno esperados.
- Otorgar a la identidad federada solo impersonacion de la Service Account de
  firma.
- Mantener en la Service Account unicamente los permisos minimos de KMS.
- No crear ni descargar llaves JSON.
- Rotar provider/claims sin modificar el recurso HSM ni el flujo PAdES.

## Verificacion

Las pruebas unitarias demuestran que el cliente KMS recibe un `AuthClient`
inyectado sin importar Vercel. La verificacion `VERCEL PRODUCTION GCP WIF
VERIFIED` solo puede declararse tras un intercambio real OIDC -> STS -> Service
Account y una operacion real contra KMS en el deployment productivo.
