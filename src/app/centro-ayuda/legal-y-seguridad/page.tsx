import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Files, ShieldCheck } from 'lucide-react';
import { listHelpCategory } from '@/lib/help/catalog.server';
import { HELP_ROOT } from '@/lib/help/model';
import { getHelpInstitutionalLinks } from '@/lib/help/support.server';
import { HelpArticleSections, HelpBreadcrumbs } from '../_components/HelpCollections';
import styles from '../help.module.css';

export const metadata: Metadata = { title: 'Aspectos legales y seguridad' };

export default function LegalAndSecurityPage() {
  const documents = getHelpInstitutionalLinks();
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs trail={[{ title: 'Aspectos legales y seguridad' }]} />
      <header className={styles.hero + ' rounded-2xl border border-border p-5 sm:p-7'}>
        <span className={styles.iconTile + ' mb-3'}>
          <ShieldCheck size={21} aria-hidden="true" />
        </span>
        <h1 className={styles.pageTitle}>Aspectos legales y seguridad</h1>
        <p className={styles.intro}>
          Entiende el alcance de la firma electrónica en México y cómo revisar los permisos, las
          constancias y las evidencias de tu documento.
        </p>
      </header>
      <HelpArticleSections articles={listHelpCategory('legal-y-seguridad')} />
      <section className={styles.panel + ' mt-4'} aria-labelledby="institutional-help-title">
        <h2 id="institutional-help-title" className="flex items-center gap-2 text-lg font-semibold">
          <Files size={19} aria-hidden="true" className="text-primary" /> Documentos institucionales
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Revisa las condiciones y los avisos que se presentan en tu operación. Para solicitar
          documentación institucional, utiliza el canal de contacto disponible.
        </p>
        {documents.length > 0 && (
          <ul className={styles.list + ' mt-3'}>
            {documents.map(({ title, href }) => (
              <li key={title} className={styles.listItem}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.listLink}
                >
                  {title} <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={HELP_ROOT + '#soporte'}
          className={styles.arrowLink + ' mt-3 text-sm'}
          prefetch={false}
        >
          Ver información de contacto
        </Link>
      </section>
    </div>
  );
}
