import type { ReactNode } from 'react';
import ColaboraShell from './_components/ColaboraShell';

export default function ColaboraLayout({ children }: { children: ReactNode }) {
  return <ColaboraShell>{children}</ColaboraShell>;
}

