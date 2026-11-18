export function canAccessOrganizationSection(
  role: string | null | undefined,
  permissionKeys: readonly string[],
  requiredPermission?: string
) {
  if (role === 'owner' || role === 'admin') return true;
  if (!requiredPermission) return true;
  return permissionKeys.includes(requiredPermission);
}

export function filterOrganizationNavigation<T extends { permission?: string }>(
  items: readonly T[],
  role: string | null | undefined,
  permissionKeys: readonly string[]
) {
  return items.filter((item) =>
    canAccessOrganizationSection(role, permissionKeys, item.permission)
  );
}
export function organizationRouteMatches(pathname: string, href: string) {
  return pathname === href || (href !== '/organizacion' && pathname.startsWith(`${href}/`));
}

export function filterOrganizationSections<T extends { label: string; description: string }>(
  items: readonly T[],
  query: string
) {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    terms.every((term) => normalize(`${item.label} ${item.description}`).includes(term))
  );
}
