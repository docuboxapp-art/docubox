import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationsDirectory = join(root, 'supabase', 'migrations');
const outputDirectory = join(root, 'docs', 'security', 'supabase-reconciliation');
mkdirSync(outputDirectory, { recursive: true });

const generatedAt = new Date().toISOString();
const corruptDocumentId = '90743d61-76f5-42ad-9cd5-9c146ea45be6';
const corruptStoragePath =
  '3f465c1f-ee48-403c-b74d-a9338859c6d2/90743d61-76f5-42ad-9cd5-9c146ea45be6/Acuse_renovacion.pdf';
const corruptExpectedHash = '0ba88cf632ffbf5fe2d63fd64019ca3d905befff249bf372089d36363bc84b6e';
const corruptActualHash = 'b5fcef933d589d87870da89051b3d64d95e53638a607f6c1ebe891198976e3ab';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

let queryCounter = 0;
function query(sql) {
  queryCounter += 1;
  const queryPath = join(outputDirectory, `.remote-query-${queryCounter}.sql`);
  writeFileSync(queryPath, sql);
  let output;
  try {
    output = run('npx', ['supabase', 'db', 'query', '--linked', '--file', queryPath], {
      shell: process.platform === 'win32',
    });
  } finally {
    rmSync(queryPath, { force: true });
  }
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) throw new Error(`SUPABASE_QUERY_JSON_MISSING: ${output.slice(0, 200)}`);
  const parsed = JSON.parse(output.slice(jsonStart));
  return parsed.rows || [];
}

function normalizeIdentifier(value) {
  return value?.replaceAll('"', '').toLowerCase() || '';
}

function addMatch(set, value) {
  const normalized = normalizeIdentifier(value);
  if (normalized) set.add(normalized);
}

function splitSqlList(value) {
  const items = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items;
}

function extractCreateTableColumns(sql, columns) {
  const pattern = /create\s+table(?:\s+if\s+not\s+exists)?\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = normalizeIdentifier(match[1]);
    let depth = 1;
    let quote = null;
    let end = match.index + match[0].length;
    for (; end < sql.length && depth > 0; end += 1) {
      const character = sql[end];
      if (quote) {
        if (character === quote && sql[end - 1] !== '\\') quote = null;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
    }
    const body = sql.slice(match.index + match[0].length, end - 1);
    for (const item of splitSqlList(body)) {
      const cleaned = item.trim();
      if (!cleaned || /^(constraint|primary|foreign|unique|check|exclude)\b/i.test(cleaned))
        continue;
      const columnMatch = cleaned.match(/^("?[\w]+"?)\s+/);
      if (columnMatch) columns.add(`${table}.${normalizeIdentifier(columnMatch[1])}`);
    }
  }
}

function extractMigrationObjects(sql) {
  const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  const result = {
    tables: new Set(),
    columns: new Set(),
    functions: new Set(),
    triggers: new Set(),
    policies: new Set(),
    indexes: new Set(),
    extensions: new Set(),
  };
  const tablePattern =
    /(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?|drop\s+table(?:\s+if\s+exists)?|insert\s+into|update|delete\s+from)\s+((?:"?[\w]+"?\.)?"?[\w]+"?)/gi;
  for (const match of withoutComments.matchAll(tablePattern)) addMatch(result.tables, match[1]);
  for (const match of withoutComments.matchAll(
    /(?:add|drop|alter)\s+column(?:\s+if\s+(?:not\s+)?exists)?\s+("?[\w]+"?)/gi
  )) {
    result.columns.add(`*.${normalizeIdentifier(match[1])}`);
  }
  extractCreateTableColumns(withoutComments, result.columns);
  for (const match of withoutComments.matchAll(
    /(?:create\s+(?:or\s+replace\s+)?|drop\s+)function(?:\s+if\s+exists)?\s+((?:"?[\w]+"?\.)?"?[\w]+"?)/gi
  ))
    addMatch(result.functions, match[1]);
  for (const match of withoutComments.matchAll(
    /(?:create|drop)\s+trigger(?:\s+if\s+exists)?\s+("?[\w]+"?)/gi
  ))
    addMatch(result.triggers, match[1]);
  for (const match of withoutComments.matchAll(
    /(?:create|drop)\s+policy(?:\s+if\s+exists)?\s+(?:"([^"]+)"|([\w]+))/gi
  ))
    addMatch(result.policies, match[1] || match[2]);
  for (const match of withoutComments.matchAll(
    /(?:create\s+(?:unique\s+)?index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?|drop\s+index(?:\s+if\s+exists)?)\s+((?:"?[\w]+"?\.)?"?[\w]+"?)/gi
  ))
    addMatch(result.indexes, match[1]);
  for (const match of withoutComments.matchAll(
    /(?:create|drop)\s+extension(?:\s+if\s+(?:not\s+)?exists)?\s+("?[\w-]+"?)/gi
  ))
    addMatch(result.extensions, match[1]);
  return {
    ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, [...value].sort()])),
    hasDml: /\b(insert\s+into|update\s+[\w".]|delete\s+from|copy\s+[\w".])\b/i.test(
      withoutComments
    ),
    touchesStorage: /\bstorage\s*\./i.test(withoutComments),
    touchesAuth: /\bauth\s*\./i.test(withoutComments),
  };
}

function migrationTimestamp(filename) {
  return filename.match(/^(\d{14})_/)?.[1] || 'INVALID';
}

function migrationName(filename) {
  return filename.replace(/^\d{14}_/, '').replace(/\.sql$/i, '');
}

function normalizeSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/;+/g, ';')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function list(values) {
  return values.length ? values.join(', ') : '-';
}

function redactSecrets(value) {
  return value
    .replace(
      /((?:password|secret|api[_-]?key|access[_-]?token)\s*(?::=|=>|=|:)\s*)'[^']*'/gi,
      "$1'[REDACTED]'"
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
      '[REDACTED_JWT]'
    );
}

const trackedFiles = new Set(
  run('git', ['ls-files', 'supabase/migrations/*.sql'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => basename(path))
);
const filenames = readdirSync(migrationsDirectory)
  .filter((filename) => filename.endsWith('.sql'))
  .sort();

const remoteHistory = query(
  'select version, name from supabase_migrations.schema_migrations order by version;'
);
const remoteVersions = new Set(remoteHistory.map((row) => row.version));
const filesByLogicalName = new Map();

const migrations = filenames.map((filename) => {
  const path = join(migrationsDirectory, filename);
  const sql = readFileSync(path, 'utf8');
  const name = migrationName(filename);
  const record = {
    timestamp: migrationTimestamp(filename),
    filename,
    name,
    sha256: createHash('sha256').update(sql).digest('hex'),
    tracked: trackedFiles.has(filename),
    remoteHistory: remoteVersions.has(migrationTimestamp(filename)),
    normalizedSql: normalizeSql(sql),
    objects: extractMigrationObjects(sql),
  };
  const existing = filesByLogicalName.get(name) || [];
  existing.push(record);
  filesByLogicalName.set(name, existing);
  return record;
});

for (const migration of migrations) {
  const siblings = filesByLogicalName.get(migration.name) || [];
  const remoteSibling = siblings.find((candidate) => candidate.remoteHistory);
  if (!migration.tracked && migration.remoteHistory) {
    migration.classification = 'REMOTE_ONLY';
    migration.evidence =
      'Archivo recuperado del historial remoto; no pertenece al historial Git rastreado.';
  } else if (migration.filename === '20260829232609_document_encryption_metadata.sql') {
    migration.classification = 'ACTUALLY_PENDING';
    migration.evidence =
      'No figura en historial remoto; tabla metadata remota es legacy/vacía y falta security_events.';
  } else if (migration.tracked && remoteSibling && remoteSibling.filename !== migration.filename) {
    migration.classification = 'SUPERSEDED';
    migration.evidence =
      migration.normalizedSql === remoteSibling.normalizedSql
        ? `Representada por ${remoteSibling.timestamp}; SQL normalizado equivalente.`
        : `Mismo nombre lógico que ${remoteSibling.timestamp}; requiere conservar la versión remota efectiva y no reejecutar a ciegas.`;
  } else {
    migration.classification = 'UNKNOWN';
    migration.evidence = migration.objects.hasDml
      ? 'Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió.'
      : 'Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair.';
  }
}

const schemaRows = query(`
  with objects as (
    select 'SCHEMA'::text as kind, n.nspname::text as object_key,
      format('CREATE SCHEMA IF NOT EXISTS %I;', n.nspname)::text as ddl
    from pg_namespace n
    where n.nspname in ('public','storage','auth')
    union all
    select 'TABLE', format('%I.%I', n.nspname, c.relname),
      format('-- TABLE %I.%I relkind=%s rls=%s force_rls=%s', n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','storage','auth') and c.relkind in ('r','p')
    union all
    select 'COLUMN', format('%I.%I.%I', table_schema, table_name, column_name),
      format('-- COLUMN %I.%I.%I %s nullable=%s default=%s', table_schema, table_name, column_name,
        coalesce(domain_name, udt_name), is_nullable, coalesce(column_default, '<none>'))
    from information_schema.columns
    where table_schema in ('public','storage','auth')
    union all
    select 'CONSTRAINT', format('%I.%I.%I', n.nspname, c.relname, con.conname),
      format('-- CONSTRAINT %I.%I %s', n.nspname, c.relname, pg_get_constraintdef(con.oid, true))
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','storage','auth')
    union all
    select 'INDEX', format('%I.%I', schemaname, indexname), indexdef
    from pg_indexes where schemaname in ('public','storage','auth')
    union all
    select 'FUNCTION', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','storage','auth') and p.prokind in ('f','p')
    union all
    select 'TRIGGER', format('%I.%I.%I', n.nspname, c.relname, t.tgname), pg_get_triggerdef(t.oid, true)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','storage','auth') and not t.tgisinternal
    union all
    select 'POLICY', format('%I.%I.%I', schemaname, tablename, policyname),
      format('-- POLICY %I ON %I.%I command=%s permissive=%s roles=%s using=%s check=%s',
        policyname, schemaname, tablename, cmd, permissive, roles::text, coalesce(qual,'<none>'), coalesce(with_check,'<none>'))
    from pg_policies where schemaname in ('public','storage','auth')
    union all
    select 'VIEW', format('%I.%I', schemaname, viewname),
      format('CREATE OR REPLACE VIEW %I.%I AS\n%s;', schemaname, viewname, definition)
    from pg_views where schemaname in ('public','storage','auth')
    union all
    select 'EXTENSION', extname, format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', extname, n.nspname)
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace
  )
  select kind, object_key, ddl from objects order by kind, object_key;
`);

const advisorOutput = run(
  'npx',
  [
    'supabase',
    'db',
    'advisors',
    '--linked',
    '--type',
    'security',
    '--level',
    'warn',
    '--fail-on',
    'none',
  ],
  { shell: process.platform === 'win32' }
);
const advisorJsonStart = advisorOutput.indexOf('{');
if (advisorJsonStart < 0) throw new Error('SUPABASE_ADVISORS_JSON_MISSING');
const securityAdvisors = JSON.parse(advisorOutput.slice(advisorJsonStart)).results || [];
const advisorCounts = Object.fromEntries(
  [...new Set(securityAdvisors.map((advisor) => advisor.name))]
    .sort()
    .map((name) => [name, securityAdvisors.filter((advisor) => advisor.name === name).length])
);
writeFileSync(
  join(outputDirectory, 'REMOTE-SECURITY-ADVISORS.json'),
  `${JSON.stringify({ captured_at: generatedAt, results: securityAdvisors }, null, 2)}\n`
);

const counts = query(`
  select 'public.documentos' as relation, count(*)::bigint as row_count from public.documentos
  union all select 'public.document_versions', count(*)::bigint from public.document_versions
  union all select 'public.document_encryption_metadata', count(*)::bigint from public.document_encryption_metadata
  union all select 'public.document_certifications', count(*)::bigint from public.document_certifications
  union all select 'public.timestamp_records', count(*)::bigint from public.timestamp_records
  union all select 'public.nom151_constancias', count(*)::bigint from public.nom151_constancias
  union all select 'public.nom151_constancias_doc', count(*)::bigint from public.nom151_constancias_doc
  union all select 'storage.objects', count(*)::bigint from storage.objects;
`);

const encryptionState = query(`
  select
    to_regclass('public.document_encryption_metadata')::text as metadata_table,
    to_regclass('public.document_encryption_security_events')::text as events_table,
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='document_encryption_metadata' and column_name='document_version_id'
    ) as metadata_has_document_version_id,
    (select count(*)::bigint from public.document_encryption_metadata) as metadata_rows;
`)[0];

const corruptStorage = query(`
  select bucket_id, name, created_at, updated_at, last_accessed_at,
    metadata->>'size' as size_bytes, metadata->>'mimetype' as mime_type,
    version, archived_at, is_delete_marker, is_versioned
  from storage.objects where name = '${corruptStoragePath.replaceAll("'", "''")}' order by created_at;
`);
const corruptDocument = query(`
  select id, documento_id, workspace_id, file_name, file_size, file_hash_sha256,
    storage_path, sealed_pdf_path, sealed_pdf_hash, estado, created_at, updated_at, fecha_completado
  from public.documentos where id = '${corruptDocumentId}'::uuid;
`);
const corruptVersions = query(`
  select id, document_id, workspace_id, version_number, status, storage_path, byte_size,
    sha256, source_version_id, frozen_at, signed_at, created_at
  from public.document_versions where document_id = '${corruptDocumentId}'::uuid order by version_number;
`);
const corruptActivity = query(`
  select action, category, created_at
  from public.document_activity_log where documento_id = '${corruptDocumentId}'::uuid order by created_at;
`);
const corruptSigningEvents = query(`
  select tipo_evento, created_at
  from public.firma_eventos where documento_id = '${corruptDocumentId}'::uuid order by created_at;
`);

const schemaHeader = `-- DOCUBOX REMOTE SCHEMA CATALOG SNAPSHOT\n-- Captured read-only: ${generatedAt}\n-- Project: kbjejiclhgjmiasauxyr\n-- PostgreSQL: 17.6\n-- IMPORTANT: this is a deterministic catalog snapshot, not a restorable pg_dump.\n-- pg_dump was unavailable because Docker/Podman is not installed on this host.\n-- Definitions that could contain credential-shaped literals are redacted.\n\n`;
writeFileSync(
  join(outputDirectory, 'REMOTE-SCHEMA.sql'),
  schemaHeader +
    schemaRows
      .map((row) => `-- [${row.kind}] ${row.object_key}\n${redactSecrets(row.ddl)};`)
      .join('\n\n') +
    '\n'
);

const remoteHistoryText = [
  `Docubox remote migration history (read-only capture ${generatedAt})`,
  `Project: kbjejiclhgjmiasauxyr`,
  `Remote entries: ${remoteHistory.length}`,
  '',
  'version | name | present_remote_history | present_local_file | tracked_in_git | tracked_logical_counterpart',
  ...remoteHistory.map((row) => {
    const exact = migrations.find((migration) => migration.timestamp === row.version);
    const counterparts = (filesByLogicalName.get(row.name) || []).filter(
      (migration) => migration.tracked
    );
    return [
      row.version,
      row.name,
      'yes',
      exact ? 'yes' : 'no',
      exact?.tracked ? 'yes' : 'no',
      list(counterparts.map((migration) => migration.filename)),
    ].join(' | ');
  }),
  '',
].join('\n');
writeFileSync(join(outputDirectory, 'REMOTE-MIGRATION-HISTORY.txt'), remoteHistoryText);

const inventoryText = [
  `Docubox local migration inventory (generated ${generatedAt})`,
  `Files present: ${migrations.length}; tracked by Git: ${trackedFiles.size}; diagnostic/untracked: ${migrations.length - trackedFiles.size}`,
  '',
  ...migrations.flatMap((migration) => [
    `timestamp: ${migration.timestamp}`,
    `filename: ${migration.filename}`,
    `sha256: ${migration.sha256}`,
    `tracked_in_git: ${migration.tracked}`,
    `present_remote_history: ${migration.remoteHistory}`,
    `classification: ${migration.classification}`,
    `tables: ${list(migration.objects.tables)}`,
    `columns: ${list(migration.objects.columns)}`,
    `functions: ${list(migration.objects.functions)}`,
    `triggers: ${list(migration.objects.triggers)}`,
    `policies: ${list(migration.objects.policies)}`,
    `indexes: ${list(migration.objects.indexes)}`,
    `extensions: ${list(migration.objects.extensions)}`,
    `has_dml: ${migration.objects.hasDml}`,
    `storage_changes: ${migration.objects.touchesStorage}`,
    `auth_changes: ${migration.objects.touchesAuth}`,
    '',
  ]),
].join('\n');
writeFileSync(join(outputDirectory, 'LOCAL-MIGRATION-INVENTORY.txt'), inventoryText);

const classificationCounts = Object.fromEntries(
  [
    'APPLIED_BUT_UNTRACKED',
    'ACTUALLY_PENDING',
    'SUPERSEDED',
    'CONFLICTING',
    'REMOTE_ONLY',
    'UNKNOWN',
  ].map((classification) => [
    classification,
    migrations.filter((migration) => migration.classification === classification).length,
  ])
);

const matrixRows = migrations.map(
  (migration) =>
    `| ${migration.filename} | ${migration.tracked ? 'sí' : 'no'} | ${migration.remoteHistory ? 'sí' : 'no'} | ${migration.classification} | ${migration.evidence.replaceAll('|', '\\|')} |`
);
writeFileSync(
  join(outputDirectory, 'MIGRATION-RECONCILIATION-MATRIX.md'),
  `# Matriz de reconciliación de migraciones\n\nGenerada: ${generatedAt}\n\nLa clasificación es fail closed. La presencia de un objeto por nombre no prueba columnas, definición, backfills ni datos históricos.\n\n| Migración | Git | Historial remoto | Clasificación | Evidencia |\n|---|---:|---:|---|---|\n${matrixRows.join('\n')}\n\n## Totales\n\n${Object.entries(
    classificationCounts
  )
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n')}\n`
);

const countsTable = counts.map((row) => `| ${row.relation} | ${row.row_count} |`).join('\n');
writeFileSync(
  join(outputDirectory, 'SUPABASE-RECONCILIATION-BASELINE.md'),
  `# Baseline de reconciliación Supabase\n\nCaptura de solo lectura: ${generatedAt}\n\n## Entorno\n\n- Proyecto vinculado: \`kbjejiclhgjmiasauxyr\`\n- Supabase CLI: \`2.116.0\`\n- PostgreSQL remoto: \`17.6\`\n- Migraciones presentes: ${migrations.length}\n- Migraciones Git: ${trackedFiles.size}\n- Migraciones remotas: ${remoteHistory.length}\n- Docker/Podman: no disponible\n- Mutaciones remotas realizadas: ninguna\n\n## Conteos críticos\n\n| Relación | Filas |\n|---|---:|\n${countsTable}\n\n## Cifrado documental\n\n- Metadata table: \`${encryptionState.metadata_table}\`\n- Metadata rows: ${encryptionState.metadata_rows}\n- Esquema versionado compatible: ${encryptionState.metadata_has_document_version_id ? 'sí' : 'no'}\n- Security events table: ${encryptionState.events_table ? `\`${encryptionState.events_table}\`` : 'ausente'}\n- Migración \`20260829232609\`: pendiente y no aplicada\n\n## Replay local\n\nNo fue posible iniciar la base descartable: \`docker: command not found (podman also not found)\`. Por tanto no existe evidencia de \`SCHEMA_LOCAL_REPLAY\` y no puede demostrarse equivalencia completa.\n\n## Dump remoto\n\n\`supabase db dump --linked\` también requiere Docker en CLI 2.116.0. \`REMOTE-SCHEMA.sql\` es un snapshot de catálogo obtenido mediante consultas read-only a \`pg_catalog\` e \`information_schema\`; no es un dump restaurable.\n\n## Decisión\n\nNo ejecutar \`migration repair\`, \`db push\`, \`--include-all\` ni la migración de cifrado hasta disponer de replay local y comparación semántica completa. Estado: \`IMPLEMENTED_PENDING_PRODUCTION_E2E\`.\n`
);
const baselinePath = join(outputDirectory, 'SUPABASE-RECONCILIATION-BASELINE.md');
writeFileSync(
  baselinePath,
  readFileSync(baselinePath, 'utf8')
    .replace(
      '\n## Cifrado documental',
      '\nLos conteos anteriores son totales de relación. El inventario de cifrado limita su universo a documentos activos y rutas original/firmada: 7 documentos, 13 objetos (12 `PLAINTEXT`, 1 `CORRUPT`, 0 `ENCRYPTED`).\n\n## Cifrado documental'
    )
    .replace(
      '\n## Decisión',
      `\n## Advisors de seguridad\n\n- Advertencias: ${securityAdvisors.length}\n${Object.entries(
        advisorCounts
      )
        .map(([name, count]) => `- \`${name}\`: ${count}`)
        .join(
          '\n'
        )}\n\nEstas advertencias se documentan en \`REMOTE-SECURITY-ADVISORS.json\`; no se ejecutó DDL para corregirlas.\n\n## Decisión`
    )
);

writeFileSync(
  join(outputDirectory, 'SUPABASE-MIGRATION-REPAIR-PLAN.md'),
  `# Plan de repair de migraciones Supabase\n\nGenerado: ${generatedAt}\n\n## Decisión actual\n\nNo se propone marcar ninguna versión como \`applied\`. El conteo \`APPLIED_BUT_UNTRACKED\` es ${classificationCounts.APPLIED_BUT_UNTRACKED}; sin replay local, cualquier repair sería especulativo.\n\n| Migración | Clasificación | Evidencia | Objetos remotos | Acción | Riesgo | Rollback |\n|---|---|---|---|---|---|---|\n${migrations.map((migration) => `| ${migration.filename} | ${migration.classification} | ${migration.evidence.replaceAll('|', '\\|')} | ${list(migration.objects.tables).replaceAll('|', '\\|')} | ${migration.classification === 'ACTUALLY_PENDING' ? 'Aplicar sólo después de reconciliar y confirmar metadata rows=0' : 'No ejecutar / no reparar'} | ${migration.classification === 'UNKNOWN' ? 'Alto' : migration.classification === 'ACTUALLY_PENDING' ? 'Medio' : 'Bajo si se conserva sin reejecutar'} | Restaurar snapshots de esquema/historial; no hay cambio actual |`).join('\n')}\n\n## Prerrequisitos de cualquier cambio futuro\n\n1. Instalar Docker Desktop o Podman y ejecutar replay descartable de las 199 migraciones Git, excluyendo copias diagnósticas remotas.\n2. Obtener pg_dump remoto restaurable y dump local del replay.\n3. Comparar definiciones, RLS, grants y efectos de datos; reclasificar sólo con evidencia completa.\n4. Capturar commit limpio, conteos y plan de reversión antes del primer repair.\n5. Ejecutar repairs, si proceden, en lotes pequeños y detenerse ante el primer conflicto.\n`
);

const storageRows = corruptStorage.length
  ? corruptStorage
      .map(
        (row) =>
          `| ${row.bucket_id} | ${row.name} | ${row.size_bytes || 'no disponible'} | ${row.created_at} | ${row.updated_at} | ${row.last_accessed_at} |`
      )
      .join('\n')
  : '| no encontrado | - | - | - | - | - |';
writeFileSync(
  join(outputDirectory, 'CORRUPT-STORAGE-OBJECT-INVESTIGATION.md'),
  `# Investigación de objeto Storage corrupto\n\nCaptura de solo lectura: ${generatedAt}\n\n## Identificación\n\n- Documento: \`${corruptDocumentId}\`\n- Folio: \`${corruptDocument[0]?.documento_id || 'no disponible'}\`\n- Tenant: \`${corruptDocument[0]?.workspace_id || 'no disponible'}\`\n- Storage path: \`${corruptStoragePath}\`\n- SHA-256 esperado en DB: \`${corruptExpectedHash}\`\n- SHA-256 real observado: \`${corruptActualHash}\`\n- Coinciden: no\n\n| Bucket | Objeto | Tamaño bytes | Creado | Actualizado | Último acceso |\n|---|---|---:|---|---|---|\n${storageRows}\n\n## Referencias\n\n- Registro de documento: ${corruptDocument.length}\n- Versiones asociadas: ${corruptVersions.length}\n- Eventos de actividad sin PII: ${corruptActivity.length}\n- Eventos de firma sin payload: ${corruptSigningEvents.length}\n\n### Versiones\n\n| ID | Versión | Estado | Storage path | Byte size | SHA-256 | Frozen | Signed |\n|---|---:|---|---|---:|---|---|---|\n${corruptVersions.map((row) => `| ${row.id} | ${row.version_number} | ${row.status} | ${row.storage_path || '-'} | ${row.byte_size || '-'} | ${row.sha256 || '-'} | ${row.frozen_at || '-'} | ${row.signed_at || '-'} |`).join('\n') || '| - | - | - | - | - | - | - | - |'}\n\n### Traza temporal sanitizada\n\n| Tipo | Acción | Categoría | Fecha |\n|---|---|---|---|\n${
    [
      ...corruptActivity.map((row) => ({
        type: 'actividad',
        action: row.action,
        category: row.category,
        date: row.created_at,
      })),
      ...corruptSigningEvents.map((row) => ({
        type: 'firma',
        action: row.tipo_evento,
        category: '-',
        date: row.created_at,
      })),
    ]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((row) => `| ${row.type} | ${row.action} | ${row.category} | ${row.date} |`)
      .join('\n') || '| - | - | - | - |'
  }\n\n## Diagnóstico\n\nLa evidencia demuestra \`metadata drift / legacy mismatch\`: el objeto existe, pero su contenido actual no corresponde a la huella registrada. Los catálogos por sí solos no permiten distinguir con certeza entre sustitución previa del objeto, hash DB incorrecto, versión equivocada o corrupción de Storage. No se encontraron ${corruptVersions.length ? 'suficientes evidencias para atribuir una causa única' : 'versiones asociadas que permitan reconstruir la procedencia'}.\n\n## Contención\n\nNo borrar, sobrescribir, migrar, regenerar, cambiar hash ni marcar válido. Excluir expresamente del lote de cifrado. Cualquier copia forense debe conservar el SHA-256 real y una cadena de custodia separada.\n`
);

writeFileSync(
  join(outputDirectory, 'SUPABASE-RECONCILIATION-FINAL.md'),
  `# Estado de reconciliación Supabase\n\nFecha: ${generatedAt}\n\n1. Supabase CLI: 2.116.0.\n2. Migraciones presentes: ${migrations.length}; Git: ${trackedFiles.size}; copias diagnósticas/nueva: ${migrations.length - trackedFiles.size}.\n3. Migraciones remotas: ${remoteHistory.length}.\n4. APPLIED_BUT_UNTRACKED: ${classificationCounts.APPLIED_BUT_UNTRACKED}.\n5. ACTUALLY_PENDING: ${classificationCounts.ACTUALLY_PENDING}.\n6. SUPERSEDED: ${classificationCounts.SUPERSEDED}.\n7. CONFLICTING: ${classificationCounts.CONFLICTING}.\n8. REMOTE_ONLY: ${classificationCounts.REMOTE_ONLY}.\n9. UNKNOWN: ${classificationCounts.UNKNOWN}.\n10. Repairs ejecutados: 0.\n11. \`db push --include-all\`: no ejecutado.\n12. \`db push --dry-run\`: sigue bloqueado por historia legacy local no conciliada.\n13. Migración de cifrado aplicada: no.\n14. RLS de cifrado nuevo: no verificable hasta aplicar; tabla legacy tiene políticas incompatibles con diseño backend-only.\n15. Storage E2E cifrado: pendiente.\n16. KMS HSM wrap/unwrap: PASS previo, no modificado.\n17. PAdES/TSA/NOM-151 sobre objetos cifrados: pendiente.\n18. Objetos legacy: 12 PLAINTEXT, 1 CORRUPT, 0 ENCRYPTED, 0 migrados.\n19. Objeto corrupto: aislado documentalmente; sin mutación.\n20. Replay local: bloqueado por ausencia de Docker/Podman.\n21. Estado final: \`IMPLEMENTED_PENDING_PRODUCTION_E2E\`.\n\n## Criterio de parada\n\nNo existe evidencia para demostrar todavía \`Git history ≈ production schema ≈ migration history\`. Se preservó el estado remoto sin DDL, DML, repairs ni despliegues.\n`
);
const finalPath = join(outputDirectory, 'SUPABASE-RECONCILIATION-FINAL.md');
writeFileSync(
  finalPath,
  readFileSync(finalPath, 'utf8').replace(
    '21. Estado final:',
    `21. Advisors: ${securityAdvisors.length} WARN (${Object.entries(advisorCounts)
      .map(([name, count]) => `${name}=${count}`)
      .join(', ')}).\n22. Estado final:`
  )
);

console.info(
  JSON.stringify(
    {
      generatedAt,
      migrations: migrations.length,
      tracked: trackedFiles.size,
      remote: remoteHistory.length,
      classifications: classificationCounts,
      outputDirectory,
    },
    null,
    2
  )
);
