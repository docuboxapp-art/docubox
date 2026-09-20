export type VersionedTemplateLike = {
  id: string;
  root_template_id?: string | null;
  version_publicada?: string | null;
  updated_at?: string | null;
};

export function getTemplateFamilyId(template: VersionedTemplateLike) {
  return template.root_template_id || template.id;
}

function versionParts(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) return [0];
  return normalized.split('.').map(Number);
}

export function compareTemplateVersions(
  left: string | null | undefined,
  right: string | null | undefined
) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectLatestTemplateVersions<T extends VersionedTemplateLike>(templates: T[]): T[] {
  const latestByFamily = new Map<string, T>();

  templates.forEach((template) => {
    const familyId = getTemplateFamilyId(template);
    const current = latestByFamily.get(familyId);
    if (!current) {
      latestByFamily.set(familyId, template);
      return;
    }

    const versionComparison = compareTemplateVersions(
      template.version_publicada,
      current.version_publicada
    );
    const templateUpdatedAt = new Date(template.updated_at || 0).getTime() || 0;
    const currentUpdatedAt = new Date(current.updated_at || 0).getTime() || 0;
    if (
      versionComparison > 0 ||
      (versionComparison === 0 && templateUpdatedAt > currentUpdatedAt)
    ) {
      latestByFamily.set(familyId, template);
    }
  });

  return Array.from(latestByFamily.values()).sort(
    (left, right) =>
      (new Date(right.updated_at || 0).getTime() || 0) -
      (new Date(left.updated_at || 0).getTime() || 0)
  );
}
