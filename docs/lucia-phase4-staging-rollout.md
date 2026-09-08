# Fase 4 - Preparacion de despliegue seguro

Fecha: 2026-09-05

## Resumen ejecutivo

La Fase 4 permanece **sin aplicar** al Supabase enlazado. El proyecto enlazado es
`databox` (`kbjejiclhgjmiasauxyr`), no esta identificado como staging y no tiene
ramas de Supabase disponibles. No se ejecuto `db push` ni `migration repair`.

El dry-run quedo ordenado y propone cuatro migraciones. La inteligencia
documental permanece apagada por defecto mediante
`LUCIA_DOCUMENT_INTELLIGENCE_ENABLED=false`.

## Decision sobre 20260904180000

La version original no era aceptable porque redefinia una funcion
`SECURITY DEFINER` con `search_path = public, pg_temp`. Como nunca fue aplicada
al remoto, se convirtio en un marcador sin DDL para conservar el orden del
historial. La intencion funcional se recreo en:

- `20260905190000_allow_draft_purge_during_recovery_secure.sql`

La nueva version usa `search_path = ''`, califica objetos, restringe ejecucion a
`service_role` y revalida papelera, Legal Hold, retencion y recuperacion dentro
de la transaccion bloqueada. Tambien elimina una referencia invalida a
`certification_webhooks.certification_id`; los webhooks son configuracion del
workspace, no hijos de una certificacion documental.

## Reparacion RAG requerida

`supabase db lint --linked` detecto que el RPC remoto
`match_document_chunks` no resuelve el operador pgvector con `search_path`
vacio. Se agrego:

- `20260905200000_fix_secure_vector_operator_resolution.sql`

La funcion conserva ACL, workspace y `allowed_document_ids`, y usa
`OPERATOR(public.<=>)` sin ampliar permisos.

## Feature flag

Se agrego `src/lib/ai/documentIntelligenceFeature.ts` y la variable backend:

```text
LUCIA_DOCUMENT_INTELLIGENCE_ENABLED=false
```

Con la bandera apagada:

- los endpoints autentican primero y luego responden `503` tipado a sesiones validas;
- LucIA responde: `La inteligencia documental aun no esta activa en este entorno.`;
- no se consultan chunks para intents de Document Intelligence;
- no se llama al proveedor IA.

Sin sesion, los tres endpoints conservan `401 UNAUTHORIZED`.

## Dry-run

Comando:

```powershell
npx supabase db push --linked --dry-run --include-all
```

Resultado correcto, sin escrituras. Orden propuesto:

1. `20260904180000_allow_draft_purge_during_recovery.sql`
2. `20260905174616_lucia_document_intelligence.sql`
3. `20260905190000_allow_draft_purge_during_recovery_secure.sql`
4. `20260905200000_fix_secure_vector_operator_resolution.sql`

## RLS y contratos

La migracion Fase 4 habilita y fuerza RLS en las siete tablas nuevas. Revoca
permisos de `PUBLIC`, `anon` y `authenticated`, devuelve `SELECT` solamente a
`authenticated` bajo ACL documental y reserva escrituras a `service_role`.

Contratos preparados:

- `supabase/tests/lucia_phase4_document_intelligence_contract.sql`
- `supabase/tests/draft_purge_recovery_contract.sql`
- `supabase/tests/lucia_vector_rpc_contract.sql`

El contrato Fase 4 tambien verifica que no existan columnas de token, OTP,
biometria, llave privada, password o ruta privada de storage.

Los contratos no se ejecutaron porque la migracion no fue aplicada y no existe
staging ni runtime local de Docker/Postgres en este equipo.

## Pruebas ejecutadas

- `npm run build`: correcto, 220 rutas.
- `npm run type-check`: correcto al ejecutarse de forma aislada.
- Fases 1, 2, 3, 3.6, 4 y ciclo de papelera: 74/74.
- Suite focalizada final: 50/50.
- ESLint focalizado con `--quiet`: 0 errores.
- `git diff --check`: correcto; solo avisos de fin de linea preexistentes.
- Endpoints sin sesion: analyze `401`, read `401`, compare `401`.

## Estado de aplicacion

- Migracion Fase 4 aplicada: **no**.
- `db push` ejecutado: **no**.
- Contrato SQL post-migracion ejecutado: **no**.
- RLS post-migracion validado en base real: **pendiente de staging**.
- Pruebas con sesion y fixtures ACL reales: **pendientes de staging**.

## Riesgos pendientes

- No existe un destino inequívoco de staging.
- El lint remoto reporta errores heredados fuera del alcance de Fase 4 en
  funciones de auditoria, KMS y organizacion; deben tratarse en migraciones
  separadas.
- Las RPC de modulos en desarrollo conservan `SCHEMA_UNAVAILABLE` hasta que sus
  esquemas de producto sean definidos.
- La bandera no debe activarse hasta ejecutar los tres contratos SQL y las
  pruebas owner/admin/miembro/externo sobre staging.

## Secuencia recomendada

1. Crear o identificar un proyecto/rama de staging.
2. Enlazar temporalmente el checkout a staging y repetir el dry-run.
3. Ejecutar `db push --include-all` solamente en staging.
4. Ejecutar los tres contratos SQL.
5. Ejecutar pruebas ACL con sesiones reales y documentos con/sin chunks.
6. Mantener el flag en `false` mientras se corrigen hallazgos.
7. Activar el flag primero en staging y observar telemetria sin PII.
8. Promover las mismas migraciones inmutables a produccion tras aprobacion.

## Recomendacion para Fase 5

No iniciar acciones automaticas. La siguiente fase debe centrarse en un worker
asincrono idempotente para jobs de analisis, con reintentos, limites de costo,
cancelacion y rollout gradual, manteniendo las sugerencias sin aplicarlas a los
documentos.
