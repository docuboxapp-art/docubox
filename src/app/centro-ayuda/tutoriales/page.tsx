import type { Metadata } from 'next';
import { publicHelpArticles } from '@/lib/help/catalog.server';
import { HelpArticleSections, HelpBreadcrumbs } from '../_components/HelpCollections';
import styles from '../help.module.css';

export const metadata: Metadata = { title: 'Tutoriales' };

export default function HelpTutorialsPage() {
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs trail={[{ title: 'Tutoriales' }]} />
      <h1 className={styles.pageTitle}>Tutoriales</h1>
      <p className={styles.intro}>
        Sigue los pasos desde tu primera invitación hasta el envío de documentos y la administración
        de tu equipo.
      </p>
      <HelpArticleSections
        articles={publicHelpArticles.filter((article) => article.kind === 'tutorial')}
      />
    </div>
  );
}
