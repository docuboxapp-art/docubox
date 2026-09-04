# Legacy Document Encryption Migration Report

Fecha: 2026-08-31

## Estado

`PRODUCTION_VERIFIED`

El lifecycle criptografico productivo y el canary permanecen en PASS. Este WP
clasifico fisicamente los 70 objetos previamente desconocidos y migro los 19
objetos plaintext elegibles. No se declara `FULLY_ENCRYPTED` porque permanecen
11 objetos plaintext huerfanos pendientes de un WP de investigacion/retencion y
59 artefactos historicos que se conservaron sin cambios.

## Inventario inicial

- objetos fisicos: 96;
- `ENCRYPTED = 6`;
- `PLAINTEXT_ELIGIBLE = 19`;
- `CORRUPT = 1`;
- `UNKNOWN = 70`;
- `MISSING = 0`.

La lectura fisica resolvio los 70 `UNKNOWN` sin mutaciones:

- `HISTORICAL_ARTIFACT = 59`;
- `ORPHAN = 11`;
- `ENCRYPTED = 0`;
- `PLAINTEXT_ELIGIBLE = 0`;
- `PLAINTEXT_NOT_ELIGIBLE = 0`;
- `DUPLICATE = 0`;
- `CORRUPT = 0`;
- `UNKNOWN_REQUIRES_REVIEW = 0`;
- `MISSING = 0`.

## Migracion por lotes

El manifest inicial contiene 19 asociaciones inequivocas entre documento,
version, workspace, ruta y SHA-256. Se ejecutaron siete lotes con un maximo de
tres objetos:

| Lote | Intentados | Migrados | Omitidos | Fallidos | Elegibles restantes | Cifrados |
| ---- | ---------: | -------: | -------: | -------: | ------------------: | -------: |
| 1    |          3 |        3 |        0 |        0 |                  16 |        9 |
| 2    |          3 |        3 |        0 |        0 |                  13 |       12 |
| 3    |          3 |        3 |        0 |        0 |                  10 |       15 |
| 4    |          3 |        3 |        0 |        0 |                   7 |       18 |
| 5    |          3 |        3 |        0 |        0 |                   4 |       21 |
| 6    |          3 |        3 |        0 |        0 |                   1 |       24 |
| 7    |          1 |        1 |        0 |        0 |                   0 |       25 |

Cada objeto completo los checkpoints `SOURCE_VERIFIED`,
`CIPHERTEXT_CREATED`, `DECRYPT_VERIFIED`, `POINTER_SWITCHED`,
`APPLICATION_VERIFIED`, `SOURCE_DELETED` y `ENCRYPTION_COMPLETED`. Los conteos
append-only son 19 por checkpoint y no existe ningun evento fallido.

## Validaciones

- AES-256-GCM con DEK y nonce unicos: PASS;
- wrap/unwrap mediante Google Cloud KMS HSM: PASS;
- ciphertext SHA-256 y ausencia de `%PDF-`: PASS;
- decrypt, tamano y SHA-256 original: PASS;
- pointer switch compare-and-set: PASS;
- preview y descarga mediante servicios existentes: PASS;
- SHA-256 descargado: PASS;
- usuario no autorizado: DENIED;
- workspace incorrecto: DENIED;
- plaintext eliminado solo despues de todas las compuertas: PASS.

Los siete lotes fueron reejecutados despues del cierre. Los 19 objetos
devolvieron `SKIP_ALREADY_ENCRYPTED`, revalidaron acceso y no generaron nuevo
ciphertext.

## Inventario final

- objetos fisicos: 96;
- `ENCRYPTED = 25`;
- `PLAINTEXT_ELIGIBLE = 0`;
- `HISTORICAL_ARTIFACT = 59`;
- `ORPHAN = 11`;
- `CORRUPT = 1`;
- `UNKNOWN_REQUIRES_REVIEW = 0`;
- `MISSING = 0`.

## Objeto corrupto

El objeto corrupto asociado al documento
`90743d61-76f5-42ad-9cd5-9c146ea45be6` conserva la misma ruta, SHA-256 y
clasificacion. No fue cifrado, borrado, rehasheado, actualizado ni reasociado.
La excepcion quedo registrada como evento append-only:

`CORRUPT_OBJECT_FORMAL_EXCEPTION`

## Evidencias

- inventario inicial: `output/legacy-encryption-inventory-2026-08-31.json`;
- lotes: `output/legacy-batch-01.json` a `output/legacy-batch-07.json`;
- revalidacion: `output/legacy-revalidation-01.json` a
  `output/legacy-revalidation-07.json`;
- inventario final: `output/legacy-encryption-final-2026-08-31.json`.

## Criterio de cierre

Los documentos activos migrables ya no conservan plaintext elegible. Sin
embargo, el criterio 12 de `FULLY_ENCRYPTED` exige que no exista plaintext
huerfano pendiente de limpieza. Los 11 objetos `ORPHAN` deben pasar por un WP
separado que determine propiedad, retencion y eliminacion segura; los 59
`HISTORICAL_ARTIFACT` requieren una politica explicita de cifrado o excepcion.
Hasta entonces, el estado correcto es `PRODUCTION_VERIFIED`.
