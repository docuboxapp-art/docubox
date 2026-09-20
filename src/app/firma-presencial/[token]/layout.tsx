import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Firma presencial | Docubox',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function InPersonSigningLayout({ children }: { children: ReactNode }) {
  return children;
}
