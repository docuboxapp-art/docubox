import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import AppLogo from '@/components/ui/AppLogo';
import { HELP_ROOT } from '@/lib/help/model';
import { HelpAppReturnLink, HelpNavigation, HelpReturn } from './_components/HelpActions';
import styles from './help.module.css';

export const metadata: Metadata = {
  title: {
    default: 'Centro de ayuda Docubox',
    template: '%s | Centro de ayuda Docubox',
  },
  description:
    'Guías y soluciones para participar, gestionar documentos y administrar tu organización en Docubox.',
  referrer: 'no-referrer',
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.root}>
      <a
        href="#contenido-ayuda"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2"
      >
        Ir al contenido
      </a>
      <header className={styles.header}>
        <div className={styles.wrap + ' ' + styles.headerRow}>
          <Link
            href={HELP_ROOT}
            prefetch={false}
            className={styles.brand}
            aria-label="Centro de ayuda Docubox"
          >
            <AppLogo />
            <span className={styles.brandText}>Centro de ayuda</span>
          </Link>
          <HelpNavigation />
          <Suspense fallback={<HelpAppReturnLink />}>
            <HelpReturn />
          </Suspense>
        </div>
      </header>
      <main id="contenido-ayuda" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.wrap + ' flex flex-wrap items-center justify-between gap-3'}>
          <span>Centro de ayuda Docubox</span>
          <nav aria-label="Enlaces del pie" className="flex flex-wrap gap-x-4 gap-y-2">
            <Link
              href={HELP_ROOT + '/legal-y-seguridad'}
              prefetch={false}
              className={styles.inlineLink}
            >
              Aspectos legales y seguridad
            </Link>
            <Link href={HELP_ROOT + '#soporte'} prefetch={false} className={styles.inlineLink}>
              Soporte
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
