import type { CaseTemplateDraft, CaseTemplateItem } from './template-builder';

export function duplicateContentItem(item: CaseTemplateItem): CaseTemplateItem {
  return {
    ...item,
    id: crypto.randomUUID(),
    title: `${item.title} (copia)`,
    allowedFormats: [...item.allowedFormats],
  };
}

/** Moving preserves content identities; deletion removes only activities that reference deleted content. */
export function removeContentSection(
  draft: CaseTemplateDraft,
  sectionId: string,
  targetId: string | null
): CaseTemplateDraft {
  const section = draft.sections.find((entry) => entry.id === sectionId);
  if (!section || draft.sections.length < 2) throw new Error('Conserva al menos una sección.');
  if (
    targetId === sectionId ||
    (targetId && !draft.sections.some((entry) => entry.id === targetId))
  )
    throw new Error('Selecciona otra sección de destino.');
  const deletedIds = new Set(targetId ? [] : section.items.map((item) => item.id));
  return {
    ...draft,
    sections: draft.sections
      .filter((entry) => entry.id !== sectionId)
      .map((entry) =>
        entry.id === targetId ? { ...entry, items: [...entry.items, ...section.items] } : entry
      ),
    stages: draft.stages.map((stage) => ({
      ...stage,
      activities: stage.activities?.filter(
        (activity) => !activity.refId || !deletedIds.has(activity.refId)
      ),
    })),
  };
}
