import type { ReactNode } from 'react';
import OrganizationShell from './_components/OrganizationShell';

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <OrganizationShell>{children}</OrganizationShell>;
}
