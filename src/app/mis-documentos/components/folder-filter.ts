export interface FilterableFolder {
  id: string;
  parentId: string | null;
}

export interface FilterableDocument {
  carpetaId?: string | null;
}

export function uniqueMatchingDocumentFolderPath<T extends FilterableFolder & { name: string }>(
  folders: T[],
  matchingDocuments: FilterableDocument[]
): { id: string; name: string }[] | null {
  if (matchingDocuments.length !== 1 || !matchingDocuments[0].carpetaId) return null;

  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const path: { id: string; name: string }[] = [];
  const visited = new Set<string>();
  let folderId: string | null = matchingDocuments[0].carpetaId;

  while (folderId) {
    if (visited.has(folderId)) return null;
    const folder = foldersById.get(folderId);
    if (!folder) return null;
    visited.add(folderId);
    path.unshift({ id: folder.id, name: folder.name });
    folderId = folder.parentId;
  }

  return path;
}

export function hasDocumentCriteria(filters: Record<string, unknown>): boolean {
  return Object.entries(filters).some(([key, value]) => {
    if (key === 'estructura' || value == null || value === '' || value === 'todos') {
      return false;
    }
    return Array.isArray(value) ? value.length > 0 : true;
  });
}

export function visibleFoldersForDocuments<T extends FilterableFolder>(
  folders: T[],
  matchingDocuments: FilterableDocument[],
  currentFolderId: string | null,
  structure: string,
  hasContentFilter: boolean
): T[] {
  if (structure === 'archivo') return [];

  const directFolders = folders.filter((folder) => folder.parentId === currentFolderId);
  if (!hasContentFilter) return directFolders;

  const parentById = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  const matchingFolderIds = new Set<string>();
  for (const document of matchingDocuments) {
    let folderId = document.carpetaId;
    const visited = new Set<string>();
    while (folderId && parentById.has(folderId) && !visited.has(folderId)) {
      matchingFolderIds.add(folderId);
      visited.add(folderId);
      folderId = parentById.get(folderId);
    }
  }

  return directFolders.filter((folder) => matchingFolderIds.has(folder.id));
}
