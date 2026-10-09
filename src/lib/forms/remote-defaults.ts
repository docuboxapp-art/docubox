import { createClient } from '@/lib/supabase/client';
import { getFormAppearanceDefaultsStorageKey, normalizeFormAppearanceDefaults, readFormAppearanceDefaults, writeFormAppearanceDefaults } from './appearance-defaults';
import { getFormExperienceDefaultsStorageKey, normalizeFormExperienceDefaults, readFormExperienceDefaults, writeFormExperienceDefaults } from './experience-defaults';
import { getFormPdfDefaultsStorageKey, normalizeFormPdfDefaults, readFormPdfDefaults, writeFormPdfDefaults } from './pdf-defaults';
import type { FormAppearance } from './schema';
import type { FormExperienceDefaults } from './experience-defaults';
import type { FormPdfDefaults } from './pdf-defaults';

type DefaultKind = 'experience' | 'appearance' | 'pdf';
type DefaultValue = { experience: FormExperienceDefaults; appearance: FormAppearance; pdf: FormPdfDefaults };

export function formDefaultsErrorMessage(error: unknown): string {
  const failure = error as { code?: string; message?: string } | null;
  if (failure?.code === '42501') return 'Tu cuenta no tiene permiso para guardar estos valores predeterminados.';
  if (failure?.code === 'PGRST205' || failure?.code === '42P01' || failure?.message?.includes('schema cache'))
    return 'No se pudo acceder a la configuración. Actualiza la página e inténtalo de nuevo.';
  return 'No se pudo sincronizar la configuración con la cuenta. Inténtalo de nuevo.';
}

function normalize<K extends DefaultKind>(kind: K, value: unknown): DefaultValue[K] {
  if (kind === 'experience') return normalizeFormExperienceDefaults(value) as DefaultValue[K];
  if (kind === 'appearance') return normalizeFormAppearanceDefaults(value) as DefaultValue[K];
  return normalizeFormPdfDefaults(value) as DefaultValue[K];
}

function cache<K extends DefaultKind>(workspaceId: string, kind: K, value: DefaultValue[K]) {
  try {
    if (kind === 'experience') writeFormExperienceDefaults(workspaceId, value as FormExperienceDefaults);
    if (kind === 'appearance') writeFormAppearanceDefaults(workspaceId, value as FormAppearance);
    if (kind === 'pdf') writeFormPdfDefaults(workspaceId, value as FormPdfDefaults);
  } catch { /* La base de datos sigue siendo la fuente de verdad. */ }
}

export async function loadFormDefaults(workspaceId: string): Promise<DefaultValue> {
  const supabase = createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('Inicia sesión para cargar la configuración.');
  const { data, error } = await supabase.from('form_default_settings')
    .select('kind,value').eq('workspace_id', workspaceId).eq('user_id', auth.user.id);
  if (error) throw error;
  const records = new Map((data || []).map((row) => [row.kind, row.value]));
  const fallbackPdf = readFormPdfDefaults(workspaceId);
  const defaults: DefaultValue = {
    pdf: records.has('pdf') ? normalize('pdf', records.get('pdf')) : fallbackPdf,
    appearance: records.has('appearance') ? normalize('appearance', records.get('appearance')) : readFormAppearanceDefaults(workspaceId),
    experience: records.has('experience') ? normalize('experience', records.get('experience')) : readFormExperienceDefaults(workspaceId, fallbackPdf.configurePdfDetails),
  };
  const legacyKeys = {
    experience: getFormExperienceDefaultsStorageKey(workspaceId),
    appearance: getFormAppearanceDefaultsStorageKey(workspaceId),
    pdf: getFormPdfDefaultsStorageKey(workspaceId),
  };
  for (const kind of ['experience', 'appearance', 'pdf'] as const) {
    if (records.has(kind)) {
      cache(workspaceId, kind, defaults[kind]);
      continue;
    }
    let hasLegacyValue = false;
    try { hasLegacyValue = typeof window !== 'undefined' && window.localStorage.getItem(legacyKeys[kind]) !== null; }
    catch { /* Los predeterminados de la cuenta funcionan sin almacenamiento local. */ }
    if (hasLegacyValue) {
      const { error: migrationError } = await supabase.from('form_default_settings').upsert({
        user_id: auth.user.id, workspace_id: workspaceId, kind, value: defaults[kind],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,workspace_id,kind' });
      if (migrationError) throw migrationError;
    }
  }
  return defaults;
}

export async function saveFormDefault<K extends DefaultKind>(workspaceId: string, kind: K, value: DefaultValue[K]): Promise<DefaultValue[K]> {
  const supabase = createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError || new Error('Inicia sesión para guardar la configuración.');
  const normalized = normalize(kind, value);
  const { data, error } = await supabase.from('form_default_settings').upsert({
    user_id: auth.user.id, workspace_id: workspaceId, kind, value: normalized,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,workspace_id,kind' }).select('value').single();
  if (error || !data) throw error || new Error('No se confirmó el guardado de la configuración.');
  const saved = normalize(kind, data.value);
  cache(workspaceId, kind, saved);
  return saved;
}
