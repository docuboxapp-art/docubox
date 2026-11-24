import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowUpRight, ListChecks } from 'lucide-react';
import { getPublicHelpArticle, listSelectedArticles } from '@/lib/help/catalog.server';
import {
  HELP_AUDIENCES,
  HELP_CATEGORIES,
  HELP_KINDS,
  HELP_ROOT,
  helpArticleHref,
  helpCategoryHref,
  type HelpSearchParams,
  type HelpSection,
} from '@/lib/help/model';
import { emitHelpUsage } from '@/lib/observability/help-usage';
import { CopyHelpArticle, HelpAppAction } from '../../_components/HelpActions';
import { HelpArticleList, HelpBreadcrumbs } from '../../_components/HelpCollections';
import HelpFeedback from '../../_components/HelpFeedback';
import styles from '../../help.module.css';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<HelpSearchParams> };
const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = getPublicHelpArticle(slug);
  return article
    ? { title: article.title, description: article.summary }
    : { robots: { index: false } };
}

function ContentIndex({ sections }: { sections: readonly HelpSection[] }) {
  return (
    <ul className="mt-2 grid gap-2 text-muted-foreground">
      {sections.map((section) => (
        <li key={section.id}>
          <a className={styles.inlineLink} href={'#' + section.id}>
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function HelpArticlePage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const article = getPublicHelpArticle(slug);
  if (!article) notFound();
  const related = listSelectedArticles(article.related);
  const hasIndex = article.sections.length >= 3;
  emitHelpUsage('article_open');
  if (query.origen === 'flujo') emitHelpUsage('contextual_help');

  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs
        trail={[
          {
            title: HELP_CATEGORIES[article.category].title,
            href: helpCategoryHref(article.category),
          },
          { title: article.title },
        ]}
      />
      <div className={styles.articleGrid}>
        <article className={styles.article}>
          <header className="border-b border-border pb-4">
            <p className="mb-1 text-sm font-semibold text-primary">{HELP_KINDS[article.kind]}</p>
            <h1 className={styles.pageTitle}>{article.title}</h1>
            <p className={styles.intro + ' text-lg'}>{article.summary}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                <p>
                  Revisado el{' '}
                  <time dateTime={article.reviewedAt}>
                    {dateFormat.format(new Date(article.reviewedAt))}
                  </time>
                </p>
                {article.updatedAt !== article.reviewedAt && (
                  <p>
                    Actualizado el{' '}
                    <time dateTime={article.updatedAt}>
                      {dateFormat.format(new Date(article.updatedAt))}
                    </time>
                  </p>
                )}
                {article.audiences.length < 3 && (
                  <p className="mt-0.5">
                    {article.audiences.map((audience) => HELP_AUDIENCES[audience]).join(' · ')}
                  </p>
                )}
              </div>
              <CopyHelpArticle path={helpArticleHref(slug)} />
            </div>
          </header>

          {article.scope && (
            <p className={styles.panel + ' ' + styles.legalPanel + ' mt-4 text-sm'}>
              {article.scope}
            </p>
          )}

          {article.requirements && (
            <section className={styles.panel + ' mt-4'} aria-labelledby="prerequisites">
              <h2 id="prerequisites" className="flex items-center gap-2 font-semibold">
                <ListChecks size={18} aria-hidden="true" className="text-primary" /> Antes de
                empezar
              </h2>
              <ul className="ml-5 mt-1 list-disc text-sm text-muted-foreground">
                {article.requirements.map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </section>
          )}

          {hasIndex && (
            <details className={styles.tocMobile}>
              <summary className="cursor-pointer font-semibold">En este artículo</summary>
              <ContentIndex sections={article.sections} />
            </details>
          )}

          {article.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className={styles.articleSection}
              aria-labelledby={section.id + '-title'}
            >
              <h2 id={section.id + '-title'}>{section.title}</h2>
              {section.steps && (
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.items && (
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}

          {article.sources && (
            <section
              id="fuentes"
              className={styles.articleSection}
              aria-labelledby="article-sources-title"
            >
              <h2 id="article-sources-title">Fuentes oficiales</h2>
              <ul>
                {article.sources.map((source) => (
                  <li key={source.href}>
                    <a
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.inlineLink + ' font-semibold'}
                    >
                      {source.title}{' '}
                      <ArrowUpRight
                        size={14}
                        className="inline-block align-text-bottom"
                        aria-hidden="true"
                      />
                    </a>
                    <p className="text-sm text-muted-foreground">{source.scope}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            {article.action && <HelpAppAction {...article.action} />}
            <Link
              href={HELP_ROOT + '#soporte'}
              prefetch={false}
              className={styles.inlineLink + ' text-sm font-semibold'}
            >
              Consultar soporte
            </Link>
          </div>

          <HelpFeedback slug={slug} />

          {related.length > 0 && (
            <section className="mt-7" aria-labelledby="related-articles-title">
              <h2 id="related-articles-title" className="mb-1 text-lg font-semibold">
                Artículos relacionados
              </h2>
              <HelpArticleList articles={related} />
            </section>
          )}
        </article>
        {hasIndex && (
          <nav aria-label="Índice del artículo" className={styles.toc}>
            <p className="font-semibold">En este artículo</p>
            <ContentIndex sections={article.sections} />
            {article.sources && (
              <a href="#fuentes" className={styles.inlineLink + ' mt-2 block'}>
                Fuentes oficiales
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
