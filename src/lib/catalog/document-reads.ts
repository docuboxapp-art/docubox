import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import {
  documentCatalogs,
  matchesCatalogScope,
  type CatalogAvailability,
  type CatalogEntry,
  type DocumentCatalogKind,
} from './classification';

type DocumentTypeRow = CatalogAvailability & {
  id: string;
  grupo_id: string;
  nombre: string;
  descripcion: string | null;
};
type DocumentTypeGroupRow = CatalogAvailability & { id: string; nombre: string; orden: number };
type DocumentTagRow = CatalogAvailability & { id: string; nombre: string; color: string };
type CatalogRow = CatalogAvailability & {
  id: string;
  nombre: string;
  grupo_id?: string;
  color?: string;
  catalog_owner_id?: string | null;
};

const catalogColumns = {
  grupo_tipo_documento: 'id,nombre,orden',
  tipo_documento: 'id,grupo_id,nombre,descripcion',
  etiquetas: 'id,nombre,color',
} as const;

export function isCatalogSchemaMissing(error: Pick<PostgrestError, 'code'> | null | undefined) {
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error?.code ?? '');
}

async function readCatalogRows<Row>(
  read: (
    columns: string,
    scoped?: boolean
  ) => PromiseLike<{
    data: Row[] | null;
    error: PostgrestError | null;
  }>,
  columns: string,
  preferenceColumns: string
) {
  const scoped = await read(`${columns},${preferenceColumns},catalog_scope`, true);
  if (!isCatalogSchemaMissing(scoped.error)) return { ...scoped, scoped: true };
  const legacy = await read(`${columns},${preferenceColumns}`);
  return {
    ...(isCatalogSchemaMissing(legacy.error) ? await read(columns) : legacy),
    scoped: false,
  };
}

export function readDocumentTypeGroups(db: SupabaseClient, signal?: AbortSignal) {
  return readCatalogRows<DocumentTypeGroupRow>(
    (columns) => {
      const query = db.from('grupo_tipo_documento').select(columns).order('orden').order('nombre');
      if (signal) query.abortSignal(signal);
      return query.overrideTypes<DocumentTypeGroupRow[], { merge: false }>();
    },
    catalogColumns.grupo_tipo_documento,
    'catalog_archived'
  );
}

async function readCatalogSettingsEntries(
  db: SupabaseClient,
  kind: DocumentCatalogKind,
  signal: AbortSignal
) {
  const definition = documentCatalogs[kind];
  const result = await readCatalogRows<CatalogRow>(
    (columns) => {
      const query = db.from(definition.table).select(columns).abortSignal(signal);
      if (definition.table === 'grupo_tipo_documento') query.order('orden');
      return query.order('nombre').overrideTypes<CatalogRow[], { merge: false }>();
    },
    catalogColumns[definition.table],
    'catalog_owner_id,catalog_archived'
  );
  return {
    error: result.error,
    scoped: result.scoped,
    entries: (result.data ?? [])
      .filter((row) => matchesCatalogScope(row, definition.scope))
      .map((row): CatalogEntry => ({
        id: row.id,
        kind,
        name: row.nombre,
        group: row.grupo_id ?? '',
        color: row.color,
        custom: Boolean(row.catalog_owner_id),
        archived: row.catalog_archived,
      })),
  };
}

export async function readDocumentCatalogSettings(
  db: SupabaseClient,
  kind: DocumentCatalogKind,
  signal: AbortSignal
) {
  const definition = documentCatalogs[kind];
  const [options, groups] = await Promise.all([
    readCatalogSettingsEntries(db, kind, signal),
    'groupKind' in definition ? readCatalogSettingsEntries(db, definition.groupKind, signal) : null,
  ]);
  if (options.error) throw options.error;
  return {
    legacy: !options.scoped || Boolean(groups && !groups.scoped),
    groups: groups?.entries ?? [],
    groupsUnavailable: Boolean(groups?.error),
    entries: options.entries,
  };
}

export function readDocumentTypes(db: SupabaseClient, groupId?: string | null) {
  return readCatalogRows<DocumentTypeRow>(
    (columns) => {
      const query = db.from('tipo_documento').select(columns).order('nombre');
      if (groupId) query.eq('grupo_id', groupId);
      return query.overrideTypes<DocumentTypeRow[], { merge: false }>();
    },
    catalogColumns.tipo_documento,
    'catalog_archived'
  );
}

export function readDocumentTags(
  db: SupabaseClient,
  document?: { ownerId: string; tagIds: string[] }
) {
  return readCatalogRows<DocumentTagRow>(
    (columns, scoped) => {
      const table = document && scoped ? 'document_catalog_tags' : 'etiquetas';
      const query = db.from(table).select(columns).order('nombre');
      if (document) {
        query.in('id', document.tagIds);
        if (columns.includes('catalog_archived'))
          query.or(`catalog_owner_id.is.null,catalog_owner_id.eq.${document.ownerId}`);
      }
      return query.overrideTypes<DocumentTagRow[], { merge: false }>();
    },
    catalogColumns.etiquetas,
    'catalog_archived'
  );
}

// Use IDs from records the caller has already authorized. The legacy endpoint
// lists shared options, even for the service role.
export function documentTypeReferences(db: SupabaseClient, typeIds: string[]) {
  return {
    async range(from: number, to: number) {
      const read = (table: string) =>
        db
          .from(table)
          .select('id,nombre')
          .in('id', typeIds)
          .order('id')
          .range(from, to)
          .overrideTypes<Pick<DocumentTypeRow, 'id' | 'nombre'>[], { merge: false }>();
      const result = await read('document_catalog_types');
      return isCatalogSchemaMissing(result.error) ? read('tipo_documento') : result;
    },
  };
}
