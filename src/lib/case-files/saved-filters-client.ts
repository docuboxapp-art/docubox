import type { SupabaseClient } from '@supabase/supabase-js';
import { caseFilterViewKey, readSavedCaseFilters, type SavedCaseFilter } from './saved-filters';

type PreferencesClient = Pick<SupabaseClient, 'from'>;
export async function loadSavedCaseFilters(
  client: PreferencesClient,
  userId: string,
  workspaceId: string
) {
  const { data, error } = await client
    .from('user_view_preferences')
    .select('custom_filters')
    .eq('user_id', userId)
    .eq('view_key', caseFilterViewKey(workspaceId))
    .maybeSingle();
  if (error) throw new Error('No se pudieron cargar tus filtros personalizados. Intenta de nuevo.');
  return readSavedCaseFilters(data?.custom_filters);
}
export async function persistSavedCaseFilters(
  client: PreferencesClient,
  userId: string,
  workspaceId: string,
  filters: SavedCaseFilter[]
) {
  const { data, error } = await client
    .from('user_view_preferences')
    .upsert(
      {
        user_id: userId,
        view_key: caseFilterViewKey(workspaceId),
        custom_filters: filters,
      },
      { onConflict: 'user_id,view_key' }
    )
    .select('custom_filters')
    .single();
  if (error || !data) throw new Error('No se pudo guardar el filtro. Intenta de nuevo.');
  return readSavedCaseFilters(data.custom_filters);
}
