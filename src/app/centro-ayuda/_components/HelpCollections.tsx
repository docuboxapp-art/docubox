import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  FolderOpen,
  KeyRound,
  Send,
  ShieldCheck,
  Signature,
  UsersRound,
} from 'lucide-react';
import { listHelpCategory } from '@/lib/help/catalog.server';
import {
  HELP_CATEGORIES,
  HELP_KINDS,
  HELP_ROOT,
  helpArticleHref,
  helpCategoryHref,
  type HelpArticle,
  type HelpAudience,
  type HelpCategory,
} from '@/lib/help/model';
import styles from '../help.module.css';

const categoryIcons = {
  acceso: KeyRound,
  'firmar-y-participar': Signature,
  'crear-y-enviar': Send,
  seguimiento: FolderOpen,
  'plantillas-y-formularios': ClipboardList,
  'cuenta-y-organizacion': UsersRound,
  'solucion-de-problemas': CircleHelp,
  'legal-y-seguridad': ShieldCheck,
};

export function HelpBreadcrumbs({ trail = [] }: { trail?: { title: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación" className={styles.breadcrumbs}>
      <Link href={HELP_ROOT} className={styles.inlineLink} prefetch={false}>
        Centro de ayuda
      </Link>
      {trail.map(({ title, href }) => (
        <span key={title} className="inline-flex min-w-0 items-center gap-1.5">
          <ChevronRight size={13} className="shrink-0" aria-hidden="true" />
          {href ? (
            <Link href={href} className={styles.inlineLink} prefetch={false}>
              {title}
            </Link>
          ) : (
            <span aria-current="page">{title}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function HelpCategoryCards({
  categories,
  audience,
}: {
  categories: HelpCategory[];
  audience?: HelpAudience;
}) {
  return (
    <div className={styles.categoryGrid}>
      {categories.map((category) => {
        const items = listHelpCategory(category, audience);
        const { title, description } = HELP_CATEGORIES[category];
        const Icon = categoryIcons[category];
        return (
          <article key={category} className={styles.categoryCard}>
            <div className="flex items-center justify-between gap-2">
              <span className={styles.iconTile}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'artículo' : 'artículos'}
              </span>
            </div>
            <div>
              <h3 className="mb-0.5 font-semibold leading-snug">
                <Link
                  href={helpCategoryHref(category)}
                  prefetch={false}
                  className={styles.arrowLink}
                >
                  {title} <ArrowRight size={14} className="shrink-0" aria-hidden="true" />
                </Link>
              </h3>
              <p className="text-sm leading-5 text-muted-foreground">{description}</p>
            </div>
            <ul className="grid gap-2 border-t border-border pt-2 text-sm">
              {items.slice(0, 2).map((article) => (
                <li key={article.slug}>
                  <Link
                    href={helpArticleHref(article.slug)}
                    prefetch={false}
                    className={styles.inlineLink}
                  >
                    {article.title}
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

export function HelpArticleList({
  articles,
  summaries = false,
}: {
  articles: readonly HelpArticle[];
  summaries?: boolean;
}) {
  return (
    <ul className={styles.list}>
      {articles.map((article) => (
        <li key={article.slug} className={styles.listItem}>
          <Link href={helpArticleHref(article.slug)} prefetch={false} className={styles.listLink}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-snug">{article.title}</span>
              {summaries && (
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  {article.summary}
                </span>
              )}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {HELP_KINDS[article.kind]}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HelpArticleSections({ articles }: { articles: readonly HelpArticle[] }) {
  const groups = new Map<string, HelpArticle[]>();
  for (const article of articles) {
    const entries = groups.get(article.section) ?? [];
    entries.push(article);
    groups.set(article.section, entries);
  }
  return (
    <div className={'mt-6 ' + styles.twoColumns}>
      {[...groups].map(([section, entries]) => (
        <section key={section} className={styles.panel}>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <BookOpen size={18} aria-hidden="true" className="shrink-0 text-primary" /> {section}
          </h2>
          <HelpArticleList articles={entries} summaries />
        </section>
      ))}
    </div>
  );
}
