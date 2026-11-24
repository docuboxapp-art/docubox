import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { listHelpCategory } from '@/lib/help/catalog.server';
import { HELP_CATEGORIES, HELP_ROOT, helpCategoryHref, readHelpFilters } from '@/lib/help/model';
import { HelpArticleSections, HelpBreadcrumbs } from '../../_components/HelpCollections';
import styles from '../../help.module.css';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = readHelpFilters({ categoria: slug }).categoria;
  return category ? HELP_CATEGORIES[category] : {};
}

export default async function HelpCategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = readHelpFilters({ categoria: slug }).categoria;
  if (!category) notFound();
  if (category === 'legal-y-seguridad') permanentRedirect(helpCategoryHref(category));
  const { title, description } = HELP_CATEGORIES[category];
  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs trail={[{ title: 'Guías', href: HELP_ROOT + '/guias' }, { title }]} />
      <h1 className={styles.pageTitle}>{title}</h1>
      <p className={styles.intro}>{description}</p>
      <HelpArticleSections articles={listHelpCategory(category)} />
    </div>
  );
}
