# Aplicacion directa del esquema de cifrado documental

Estado: **ABORTED_PRECONDITION_FAILED**

## Registro

- Fecha local: 2026-08-29 (America/Chihuahua)
- Captura UTC confirmatoria: 2026-08-30 02:47:15.298794 UTC
- Proyecto: `kbjejiclhgjmiasauxyr`
- SQL source: `supabase/migrations/20260829232609_document_encryption_metadata.sql`
- SHA-256 auditado inicialmente: `733b6c01bebd3471a6b972233638ddfa31dc849c9391f7f6838af4a08b59fe30`
- SHA-256 preparado tras hardening legacy: `5ece4309396de6c0440ba9fb860a92d4b8fcca4e1dfaa2e59762630e0b116f36`
- Mecanismo previsto: consulta administrativa directa, sin `db push` y sin modificar `supabase_migrations.schema_migrations`
- DDL ejecutado: ninguno
- DML ejecutado: ninguno
- Deploy ejecutado: no
- Regresion posterior a schema: no ejecutada; el schema no fue aplicado

## Backup

Resultado: **FAIL / NO VERIFICABLE**.

`supabase backups list --project-ref kbjejiclhgjmiasauxyr` devolvio:

- `pitr_enabled=false`
- `walg_enabled=true`
- `backups=null`
- `physical_backup_data={}`

No existe evidencia de un punto recuperable disponible para esta intervencion. El
snapshot de catalogo `REMOTE-SCHEMA.sql` no sustituye un backup restaurable de
PostgreSQL. Conforme al criterio fail closed, no se continuo hacia DDL.

## Precheck de metadata legacy

Una primera consulta diagnostica mostro `1`, pero se descarto porque no incluia
`FROM public.document_encryption_metadata`; ese valor correspondia a la fila
implicita del `SELECT` y no al contenido de la tabla. La consulta valida y
atomica a las 02:47:15 UTC devolvio:

- `legacy_rows=0`
- `has_rows=false`
- `latest_row_created_at=null`
- esquema compatible: no
- `document_encryption_security_events`: ausente

No existe evidencia de filas transitorias ni de actividad concurrente a partir de
estas lecturas. El precheck obligatorio es **PASS: 0 filas**. La aplicacion no
continuo por el fallo independiente del requisito de backup. La migracion conserva
su guardia `legacy_document_encryption_metadata_not_empty` y la operacion futura
debe repetir el conteo dentro de la misma transaccion.

## Revision del SQL

El archivo:

- no modifica Auth ni Storage;
- no cambia PAdES, TSA, NOM-151 ni KMS;
- no contiene DEK plaintext, KEK ni private keys;
- sustituye la tabla legacy solo si esta vacia;
- crea metadata versionada y eventos de seguridad;
- enlaza tenant, documento y version mediante FK;
- almacena unicamente wrapped DEK, nonce, tag, AAD hash, hashes y metadata KMS;
- habilita RLS y revoca acceso de `anon` y `authenticated`;
- limita el acceso persistente a `service_role`.
- retira el trigger legacy `trg_sync_dek_counts`, incompatible con las columnas
  del esquema nuevo;
- revoca ejecucion publica de los tres helpers `SECURITY DEFINER` relacionados.

## Superficie legacy observada

La tabla legacy sigue exponiendo privilegios `SELECT`, `INSERT`, `UPDATE`,
`DELETE`, `TRUNCATE`, `REFERENCES` y `TRIGGER` a `anon` y `authenticated`.
RLS contiene policies de workspace para usuarios autenticados, pero la metadata
incluye material criptografico envuelto que el diseno nuevo reserva al backend.

Las funciones:

- `is_workspace_member_for_encryption(uuid)`
- `sync_encryption_metadata_dek_counts()`

son `SECURITY DEFINER` y actualmente ejecutables por `anon` y `authenticated`.
Son findings relacionados con cifrado y deben cerrarse en la misma ventana segura
en la que se aplique el esquema definitivo.

## Objetos

- Creados: ninguno
- Sustituidos: ninguno
- Eliminados: ninguno
- Registros modificados: ninguno
- Migration history modificado: no

## Resultado

La aplicacion directa queda bloqueada hasta que se cumpla el requisito de backup:

1. backup o punto de restauracion recuperable y comprobado;

En la ventana futura se repetira ademas el precheck de cero filas dentro de la
transaccion antes del DDL.

Estado conservado: `IMPLEMENTED_PENDING_PRODUCTION_E2E`.
