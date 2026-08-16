export function canAccessOrganizationSection(
  role: string | null | undefined,
  permissionKeys: readonly string[],
  requiredPermission?: string,
) {
  if (role === 'owner' || role === 'admin') return true;
  if (!requiredPermission) return true;
  return permissionKeys.includes(requiredPermission);
}

export function filterOrganizationNavigation<T extends { permission?: string }>(
  items: readonly T[],
  role: string | null | undefined,
  permissionKeys: readonly string[],
) {
  return items.filter((item) => canAccessOrganizationSection(role, permissionKeys, item.permission));
}
