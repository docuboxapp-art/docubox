import type { Metadata } from 'next';
import { HELP_CATEGORIES, type HelpCategory } from '@/lib/help/model';
import { HelpBreadcrumbs, HelpCategoryCards } from '../_components/HelpCollections';
import styles from '../help.module.css';

export const metadata: Metadata = { title: 'Guías por tema' };

export default function HelpGuidesPage() {
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs trail={[{ title: 'Guías' }]} />
      <h1 className={styles.pageTitle}>Guías por tema</h1>
      <p className={styles.intro}>
        Elige el tema de la acción que quieres realizar o del problema que encontraste.
      </p>
      <div className="mt-6">
        <HelpCategoryCards categories={Object.keys(HELP_CATEGORIES) as HelpCategory[]} />
      </div>
    </div>
  );
}
