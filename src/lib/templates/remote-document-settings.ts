import { createClient } from '@/lib/supabase/client';
import {
  normalizeTemplateDocumentSettings,
  readTemplateDocumentSettings,
  writeTemplateDocumentSettings,
  type TemplateDocumentSettings,
} from './document-settings';

export async function loadTemplateDocumentSettings(workspaceId: string) {
  const { data, error } = await createClient()
    .from('workspace_ui_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'template_document')
    .maybeSingle();
  if (error) throw error;
  return data ? normalizeTemplateDocumentSettings(data.value) : readTemplateDocumentSettings(workspaceId);
}

export async function saveTemplateDocumentSettings(
  workspaceId: string,
  settings: TemplateDocumentSettings
) {
  const value = normalizeTemplateDocumentSettings(settings);
  const { data, error } = await createClient()
    .from('workspace_ui_settings')
    .upsert({ workspace_id: workspaceId, kind: 'template_document', value })
    .select('value')
    .single();
  if (error) throw error;
  const saved = normalizeTemplateDocumentSettings(data.value);
  try {
    writeTemplateDocumentSettings(workspaceId, saved);
  } catch {
    // The saved value can still be fetched from the workspace.
  }
  return saved;
}
