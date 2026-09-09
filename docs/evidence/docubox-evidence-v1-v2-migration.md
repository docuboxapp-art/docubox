# Migracion de Evidence XML v1 a Evidence Package v2

## Compatibilidad

XML v1 permanece inmutable en su ruta y columnas historicas (`xml_evidencia_path`, `xml_hash_sha256`, `xml_generated_at`). No se recalcula, no se reemplaza y no se cambia su significado.

v2 usa nuevas tablas (`evidence_packages` y `evidence_package_artifacts`) y rutas versionadas. El visor debe decidir por `evidence_version`: `1` conserva el flujo actual y `2` ofrece el paquete y su verificador independiente.

## Diferencias con v1

- v1 usa un HMAC opcional y declara XMLDSig/NOM-151 en un texto aunque puedan no existir artefactos; v2 no usa esa declaracion.
- v1 concatena XML para calcular su huella; v2 define canonicalizacion JSON, cadena de bytes y digests sin ambiguedad.
- v1 puede sobrescribir `evidencia.xml`; v2 prohíbe sobrescribir un paquete cerrado.
- v1 mezcla informacion de actividad general; v2 toma la bitacora legal inmutable y la reduce a eventos probatorios secuenciados.

## Pasos antes de produccion

1. Aplicar la migracion v2 en un entorno de ensayo y ejecutar los tests de la base de datos/RLS.
2. Confirmar que el bucket privado `evidence-v2-artifacts` fue creado por la migracion y que su politica solo permite el backend autorizado.
3. Configurar y validar KMS/HSM para `EVIDENCE_SEAL`; sin ello v2 puede generarse pero queda `incomplete`.
4. Ejecutar pruebas de PAdES B-T, TSA, OTS y NOM-151 con proveedores reales. Cada proveedor debe dejar un artefacto verificable antes de aparecer como `valid`.
5. Publicar el verificador independiente y ejecutar los golden fixtures en CI.
6. Activar `DOCUBOX_EVIDENCE_V2_ENABLED=true` primero para un workspace de ensayo. Activar la firma KMS de v2 por separado.
7. Mantener los XML v1 descargables y medir los resultados v2 antes de habilitarlo por defecto.
