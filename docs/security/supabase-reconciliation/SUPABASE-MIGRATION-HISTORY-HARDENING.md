# WP - SUPABASE-MIGRATION-HISTORY-HARDENING

## Objetivo

Resolver por separado la divergencia entre las 199 migraciones Git, las 25
entradas remotas y el esquema productivo, sin bloquear ni mezclarse con la
instalacion quirurgica del esquema de cifrado documental.

## Baseline

- Migraciones presentes: 225
- Git: 199
- Historial remoto: 25
- `REMOTE_ONLY`: 25
- `SUPERSEDED`: 25
- `UNKNOWN`: 174
- `APPLIED_BUT_UNTRACKED` demostradas: 0
- Repairs ejecutados: 0

## Scope futuro

1. Preparar un entorno descartable con runtime compatible con Docker.
2. Reproducir exclusivamente la historia Git autoritativa.
3. Generar `SCHEMA_LOCAL_REPLAY` y un `pg_dump` remoto restaurable.
4. Comparar tablas, columnas, constraints, funciones, triggers, RLS, policies,
   grants y efectos de backfills.
5. Reclasificar cada `UNKNOWN` solo con evidencia semantica completa.
6. Proponer repairs unicamente para `APPLIED_BUT_UNTRACKED` demostradas.
7. Ejecutar en lotes pequenos con snapshot, rollback y dry-run por lote.

## Fuera de scope

- cifrado AES-GCM;
- Google Cloud KMS/HSM;
- PAdES;
- TSA;
- NOM-151;
- migracion de objetos Storage;
- objeto corrupto preservado.

## Criterio de salida

`supabase db push --dry-run` solo enumera cambios funcionalmente pendientes y no
propone reconstruir el esquema historico. Nunca usar `migration repair` para
ocultar una diferencia no demostrada.

