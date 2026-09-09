# Migracion de Evidence XML v1 a Evidence Package v2

## Compatibilidad

XML v1 permanece inmutable en su ruta y columnas historicas (`xml_evidencia_path`, `xml_hash_sha256`, `xml_generated_at`). No se recalcula, no se reemplaza y no se cambia su significado.

v2 usa nuevas tablas (`evidence_packages` y `evidence_package_artifacts`) y rutas versionadas. El visor reconoce ambos: la auditoria v1 conserva su flujo actual y la tarjeta Evidence Package v2 ofrece XML, ZIP, QR y verificacion independiente.

## Diferencias con v1

- v1 usa un HMAC opcional y declara XMLDSig/NOM-151 en un texto aunque puedan no existir artefactos; v2 no usa esa declaracion.
- v1 concatena XML para calcular su huella; v2 define canonicalizacion JSON, cadena de bytes y digests sin ambiguedad.
- v1 puede sobrescribir `evidencia.xml`; v2 prohíbe sobrescribir un paquete cerrado.
- v1 mezcla informacion de actividad general; v2 toma la bitacora legal inmutable y la reduce a eventos probatorios secuenciados.

## Integracion operativa

- Los cierres nuevos generan v2 desde el backend al finalizar PAdES-B-T/NOM-151.
- Los documentos historicos pueden generarlo manualmente desde el visor sin modificar v1.
- RFC 3161, NOM-151 y OpenTimestamps se registran como artefactos append-only con procedencia e idempotencia.
- El XML cerrado no cambia cuando OpenTimestamps pasa de pendiente a verificado; la nueva prueba se anexa al paquete.
- El manifiesto de OpenTimestamps queda comprometido en el XML cerrado. Una prueba Bitcoin posterior debe validar contra esa misma huella antes de anexarse.
- e.firma conserva un paquete probatorio privado verificable con certificado publico, payload y firma, pero nunca con llave privada o contrasena.
- Las imagenes y trazos de firma autografa se agregan como artefactos privados y se vinculan con las huellas declaradas en el XML.
- La verificacion publica usa un token opaco exclusivo y nunca expone rutas de Storage, certificados completos, IP o GPS.

## Pasos antes de produccion

1. Aplicar, en orden, `20260909110000_docubox_evidence_package_v2.sql` y `20260909120000_close_evidence_package_v2_integration.sql` en un entorno de ensayo; despues ejecutar las pruebas de base de datos, RLS y aislamiento entre tenants.
2. Confirmar que el bucket privado `evidence-v2-artifacts` fue creado por la migracion y que su politica solo permite el backend autorizado.
3. Desplegar la Edge Function `sign-efirma`; verificar que pueda escribir el paquete probatorio en el bucket privado `evidence` y las nuevas columnas de `signature_evidence`.
4. Configurar y validar KMS/HSM para `EVIDENCE_SEAL`; sin ello v2 puede generarse pero queda `incomplete`.
5. Ejecutar pruebas de PAdES-B-T, TSA, OpenTimestamps y NOM-151 con proveedores reales. Cada proveedor debe dejar un artefacto verificable antes de aparecer como `valid`.
6. Ejecutar los golden fixtures y la verificacion PDF/XML/ZIP en CI. Probar tambien alteracion de cada artefacto y ausencia de archivos declarados.
7. Activar `DOCUBOX_EVIDENCE_V2_ENABLED=true` primero en ensayo. Activar `DOCUBOX_EVIDENCE_V2_KMS_SIGNING_ENABLED=true` solo despues de validar la llave y su politica.
8. Cerrar un documento de cada metodo de firma, descargar el paquete y verificarlo por el endpoint autenticado, el endpoint publico por token y la carga independiente.
9. Mantener los XML v1 descargables y medir los resultados v2 antes de habilitarlo por defecto.

La aplicacion de migraciones, el despliegue de la Edge Function, la configuracion de variables y la activacion de banderas son operaciones separadas del codigo fuente. Mientras no se ejecuten y validen en el entorno objetivo, la clasificacion correcta es `READY_BEHIND_FEATURE_FLAG`, no `READY_FOR_PRODUCTION`.
