'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isCatalogSchemaMissing } from './document-reads';
import {
  catalogVisibilityKey,
  type CatalogEntry,
  type CatalogKind,
  type PersonalCatalogKind,
} from './classification';

type CatalogPreferences = { entries: CatalogEntry[]; hidden: ReadonlySet<string> };
const emptyCatalog: CatalogPreferences = { entries: [], hidden: new Set() };
const personalColumns = 'id,kind,name,group_key,color,archived';

function personalCatalogUnavailable(result: { error: { code: string } | null; status?: number }) {
  return (
    isCatalogSchemaMissing(result.error) ||
    (result.status === 403 && result.error?.code === '42501')
  );
}

export function usePersonalCatalog(userId: string | undefined, includeEntries = true) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    userId: string;
    revision: number;
    data: CatalogPreferences;
    failed: boolean;
    unavailable?: boolean;
  }>();
  useEffect(() => {
    if (!userId) return;
    const ownerId = userId;
    const abort = new AbortController();
    async function load() {
      try {
        const db = createClient();
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]);
        const [visibility, personal] = await Promise.all([
          db
            .from('user_catalog_hidden')
            .select('kind,entry_id')
            .eq('user_id', ownerId)
            .abortSignal(signal),
          includeEntries
            ? db
                .from('user_catalog_entries')
                .select(personalColumns)
                .eq('user_id', ownerId)
                .abortSignal(signal)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (abort.signal.aborted) return;
        if (personalCatalogUnavailable(visibility) || personalCatalogUnavailable(personal)) {
          setState({
            userId: ownerId,
            revision,
            data: emptyCatalog,
            failed: false,
            unavailable: true,
          });
          return;
        }
        if (visibility.error || personal.error) throw new Error('catalog');
        setState({
          userId: ownerId,
          revision,
          failed: false,
          data: {
            hidden: new Set(
              (visibility.data ?? []).map((row) => catalogVisibilityKey(row.kind, row.entry_id))
            ),
            entries: (personal.data ?? []).map((row) => ({
              id: row.id,
              name: row.name,
              group: row.group_key,
              kind: row.kind,
              color: row.color,
              archived: row.archived,
              custom: true,
            })),
          },
        });
      } catch {
        if (!abort.signal.aborted) {
          setState((previous) => ({
            userId: ownerId,
            revision,
            failed: true,
            data: previous?.userId === ownerId ? previous.data : emptyCatalog,
          }));
        }
      }
    }
    void load();
    return () => abort.abort();
  }, [userId, includeEntries, revision]);
  const current = state?.userId && state.userId === userId ? state : undefined;
  return {
    ...(current?.data ?? emptyCatalog),
    error: Boolean(current?.failed),
    unavailable: Boolean(current?.unavailable),
    loading: Boolean(userId && current?.revision !== revision),
    refresh: () => setRevision((value) => value + 1),
  };
}

export async function setCatalogHidden(
  userId: string,
  kind: CatalogKind,
  id: string,
  hidden: boolean
) {
  const table = createClient().from('user_catalog_hidden');
  const result = hidden
    ? await table.upsert(
        { user_id: userId, kind, entry_id: id },
        { onConflict: 'user_id,kind,entry_id', ignoreDuplicates: true }
      )
    : await table.delete().eq('user_id', userId).eq('kind', kind).eq('entry_id', id);
  if (result.error) throw result.error;
}

export async function savePersonalCatalogEntry(
  userId: string,
  entry: { kind: PersonalCatalogKind; name: string; group: string; color: string },
  id?: string
) {
  const table = createClient().from('user_catalog_entries');
  const values = { name: entry.name, group_key: entry.group, color: entry.color };
  const query = id
    ? table
        .update(values)
        .eq('id', id)
        .eq('user_id', userId)
        .eq('kind', entry.kind)
        .eq('archived', false)
    : table.insert({ ...values, kind: entry.kind, user_id: userId });
  const result = await query.select('id').single();
  if (result.error) throw result.error;
}
