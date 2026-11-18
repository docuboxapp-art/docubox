import type { ReactNode } from 'react';
import OrganizationShell from './_components/OrganizationShell';
import '@/styles/organization.css';

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <OrganizationShell>{children}</OrganizationShell>;
}
