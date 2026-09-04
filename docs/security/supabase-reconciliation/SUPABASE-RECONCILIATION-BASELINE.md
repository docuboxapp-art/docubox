# Baseline de reconciliación Supabase

Captura de solo lectura: 2026-08-30T02:39:43.319Z

## Entorno

- Proyecto vinculado: `kbjejiclhgjmiasauxyr`
- Supabase CLI: `2.116.0`
- PostgreSQL remoto: `17.6`
- Migraciones presentes: 225
- Migraciones Git: 199
- Migraciones remotas: 25
- Docker/Podman: no disponible
- Mutaciones remotas realizadas: ninguna

## Conteos críticos

| Relación | Filas |
|---|---:|
| public.documentos | 63 |
| public.document_versions | 9 |
| public.document_encryption_metadata | 0 |
| public.document_certifications | 9 |
| public.timestamp_records | 7 |
| public.nom151_constancias | 0 |
| public.nom151_constancias_doc | 25 |
| storage.objects | 397 |

Los conteos anteriores son totales de relación. El inventario de cifrado limita su universo a documentos activos y rutas original/firmada: 7 documentos, 13 objetos (12 `PLAINTEXT`, 1 `CORRUPT`, 0 `ENCRYPTED`).

## Cifrado documental

- Metadata table: `document_encryption_metadata`
- Metadata rows: 0
- Esquema versionado compatible: no
- Security events table: ausente
- Migración `20260829232609`: pendiente y no aplicada

## Replay local

No fue posible iniciar la base descartable: `docker: command not found (podman also not found)`. Por tanto no existe evidencia de `SCHEMA_LOCAL_REPLAY` y no puede demostrarse equivalencia completa.

## Dump remoto

`supabase db dump --linked` también requiere Docker en CLI 2.116.0. `REMOTE-SCHEMA.sql` es un snapshot de catálogo obtenido mediante consultas read-only a `pg_catalog` e `information_schema`; no es un dump restaurable.

## Advisors de seguridad

- Advertencias: 195
- `anon_security_definer_function_executable`: 76
- `auth_leaked_password_protection`: 1
- `authenticated_security_definer_function_executable`: 86
- `extension_in_public`: 3
- `function_search_path_mutable`: 29

Estas advertencias se documentan en `REMOTE-SECURITY-ADVISORS.json`; no se ejecutó DDL para corregirlas.

## Decisión

No ejecutar `migration repair`, `db push`, `--include-all` ni la migración de cifrado hasta disponer de replay local y comparación semántica completa. Estado: `IMPLEMENTED_PENDING_PRODUCTION_E2E`.
