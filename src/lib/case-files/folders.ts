import type { SupabaseClient } from '@supabase/supabase-js';

export type CaseFolder = { id: string; name: string; description: string; caseIds: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function caseFolderKey(workspaceId: string) {
  if (!uuid.test(workspaceId)) throw new Error('Selecciona un espacio de trabajo válido.');
  return `mis_expedientes_carpetas_v1:${workspaceId}`;
}
export function readCaseFolders(raw: unknown): CaseFolder[] {
  if (!Array.isArray(raw)) return [];
  const folders: CaseFolder[] = [];
  for (const row of raw) {
    if (
      !row ||
      typeof row !== 'object' ||
      !uuid.test(row.id) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      folders.some((f) => f.id === row.id)
    )
      continue;
    folders.push({
      id: row.id,
      name: row.name.trim().slice(0, 80),
      description: typeof row.description === 'string' ? row.description.slice(0, 200) : '',
      caseIds: Array.isArray(row.caseIds)
        ? [
            ...new Set<string>(
              row.caseIds.filter(
                (id: unknown): id is string => typeof id === 'string' && uuid.test(id)
              )
            ),
          ]
        : [],
    });
  }
  return folders;
}
export function addCaseFolder(folders: CaseFolder[], value: CaseFolder) {
  if (!value.name.trim()) throw new Error('Escribe el nombre de la carpeta.');
  if (value.name.trim().length > 80 || value.description.length > 200)
    throw new Error('Usa hasta 80 caracteres en el nombre y 200 en la descripción.');
  if (
    folders.some(
      (f) =>
        f.id !== value.id &&
        f.name.toLocaleLowerCase('es') === value.name.trim().toLocaleLowerCase('es')
    )
  )
    throw new Error('Ya tienes una carpeta con ese nombre.');
  const normalized = readCaseFolders([value])[0];
  if (!normalized) throw new Error('La carpeta no es válida.');
  return [...folders.filter((f) => f.id !== value.id), normalized];
}
export function moveCaseToFolder(folders: CaseFolder[], caseId: string, folderId: string) {
  if (!uuid.test(caseId) || (folderId && !folders.some((f) => f.id === folderId)))
    throw new Error('Selecciona una carpeta válida.');
  return folders.map((f) => ({
    ...f,
    caseIds: [...f.caseIds.filter((id) => id !== caseId), ...(f.id === folderId ? [caseId] : [])],
  }));
}
export async function loadCaseFolders(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  workspaceId: string
) {
  const { data, error } = await client
    .from('user_view_preferences')
    .select('custom_filters')
    .eq('user_id', userId)
    .eq('view_key', caseFolderKey(workspaceId))
    .maybeSingle();
  if (error) throw new Error('No se pudieron cargar tus carpetas.');
  return readCaseFolders(data?.custom_filters);
}
export async function saveCaseFolders(
  client: Pick<SupabaseClient, 'from'>,
  userId: string,
  workspaceId: string,
  folders: CaseFolder[]
) {
  const { data, error } = await client
    .from('user_view_preferences')
    .upsert(
      {
        user_id: userId,
        view_key: caseFolderKey(workspaceId),
        custom_filters: readCaseFolders(folders),
      },
      { onConflict: 'user_id,view_key' }
    )
    .select('custom_filters')
    .single();
  if (error || !data) throw new Error('No se pudieron guardar tus carpetas. Intenta de nuevo.');
  return readCaseFolders(data.custom_filters);
}
