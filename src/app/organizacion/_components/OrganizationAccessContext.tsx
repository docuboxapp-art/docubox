'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { canAccessOrganizationSection } from '@/lib/organization/navigation';

const OrganizationAccessContext = createContext<{ canAccess: (permission: string) => boolean }>({
  canAccess: (_permission: string) => false,
});

export function OrganizationAccessProvider({
  role,
  permissionKeys,
  children,
}: {
  role: string;
  permissionKeys: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      canAccess: (permission: string) =>
        canAccessOrganizationSection(role, permissionKeys, permission),
    }),
    [role, permissionKeys]
  );
  return (
    <OrganizationAccessContext.Provider value={value}>
      {children}
    </OrganizationAccessContext.Provider>
  );
}

export function useOrganizationAccess() {
  return useContext(OrganizationAccessContext);
}
