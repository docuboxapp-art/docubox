# WP-CRYPTO-01 - Resultado

**Estado:** PASS (implementación de aplicación y migración lista para aplicar)
**Fecha:** 2026-08-21
**Alcance:** Foundation Truthful Certification

## Resultado verificable

WP-CRYPTO-01 deja una base honesta para certificación. La aplicación puede
comprobar la integridad SHA-256 de una versión documental exacta, congelar su
fuente en Storage y preservar la cadena de evidencia. No declara todavía una
firma PAdES, un certificado X.509, una TSA RFC 3161 o una constancia NOM-151
como válidos sin artefactos y verificación independiente.

| Capacidad | Estado base | Estado de proveedor sin verificación independiente |
| --- | --- | --- |
| Integridad SHA-256 | valid | valid |
| Firma PDF PAdES | not_configured | manual_review |
| Certificado X.509 | not_configured | manual_review |
| Estampa RFC 3161 | not_configured | not_configured |
| Verificación independiente | pending | manual_review |
| NOM-151 | not_configured | not_configured |

## Cambios aplicados

- Se añadieron los estados processing y manual_review al contrato de
  capacidades.
- Se añadió nom151_status, independiente de PAdES y RFC 3161, mediante la
  migración aditiva
  [20260821100000_wp_crypto_01_capability_statuses.sql](../../supabase/migrations/20260821100000_wp_crypto_01_capability_statuses.sql).
- El resumen de certificación expone nom151Status.
- La finalización genérica de certificación conserva la integridad comprobable,
  pero deja firma PDF, certificado y verificación en manual_review.
- El endpoint histórico del VPS está encapsulado como
  LegacyLocalPemSigningProvider, marcado deprecated, sin clave privada en la
  aplicación ni en el frontend.
- El panel heredado, el visor y los correos ya no anuncian PAdES, certificado
  Docubox ni TSA como hechos cuando no existe evidencia técnica.

## Controles de origen

~~~mermaid
flowchart LR
  A[Documento y versión solicitada] --> B{Mismo documento y tenant}
  B -- No --> X[403 DOCUMENT_VERSION_SCOPE_MISMATCH]
  B -- Sí --> C[Descargar bytes de Storage]
  C -- No disponibles --> Y[422 DOCUMENT_VERSION_BYTES_UNAVAILABLE]
  C -- Disponibles --> D{SHA-256 coincide}
  D -- No --> Z[409 DOCUMENT_VERSION_HASH_MISMATCH]
  D -- Sí --> E[Fuente inmutable de certificación]
~~~

## Regresiones cubiertas

El archivo [crypto-foundation.test.mjs](../../tests/crypto-foundation.test.mjs)
cubre:

- SHA-256 estable y cambio de un byte.
- Canonicalización de evidencia.
- Estados fundacionales y de proveedor sin afirmaciones anticipadas.
- Vínculo exacto entre certificación y versión.
- Rechazo de versión de otro documento o tenant.
- Fallo cerrado ante bytes inexistentes en Storage.
- Estados nuevos y nom151_status en la migración.
- Encapsulación del firmador PEM legado.
- Ausencia de afirmaciones PAdES/TSA/CA en la ruta, panel y correo heredados.

## Límites deliberados

Los siguientes puntos permanecen fuera de WP-CRYPTO-01:

- KeyManagementProvider y OpenBao Transit: WP-CRYPTO-03.
- Certificado X.509 administrado: WP-CRYPTO-04.
- PAdES-B-B verificable: WP-CRYPTO-05.
- RFC 3161 y PAdES-B-T: WP-CRYPTO-06.
- Verificación independiente y endurecimiento operativo: WP-CRYPTO-07 y
  WP-CRYPTO-08.

La migración debe aplicarse al proyecto Supabase antes de desplegar esta
versión. Mientras tanto, los consumidores deben aceptar la ausencia de
nom151_status como not_configured.
