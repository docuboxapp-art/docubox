import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowUpRight, SearchX } from 'lucide-react';
import { searchHelp } from '@/lib/help/catalog.server';
import {
  HELP_AUDIENCES,
  HELP_CATEGORIES,
  HELP_KINDS,
  HELP_ROOT,
  helpArticleHref,
  readHelpFilters,
  type HelpSearchParams,
} from '@/lib/help/model';
import { cleanHelpQuery, helpSearchHref } from '@/lib/help/query';
import { emitHelpUsage } from '@/lib/observability/help-usage';
import { HelpBreadcrumbs } from '../_components/HelpCollections';
import HelpSearch from '../_components/HelpSearch';
import styles from '../help.module.css';

export const metadata: Metadata = { title: 'Buscar ayuda', robots: { index: false, follow: true } };

export default async function HelpSearchPage({
  searchParams,
}: {
  searchParams: Promise<HelpSearchParams>;
}) {
  const params = await searchParams;
  const filters = readHelpFilters(params);
  const query = cleanHelpQuery(params.q);
  if (params.q !== undefined && params.q !== query) redirect(helpSearchHref(query, filters));

  const searched = query.length >= 2;
  const results = searched ? searchHelp(query, filters) : [];
  if (searched) emitHelpUsage(results.length ? 'search' : 'search_empty');
  const clear = Boolean(filters.categoria || filters.audiencia || filters.tipo);

  return (
    <div className={styles.wrap + ' ' + styles.page}>
      <HelpBreadcrumbs trail={[{ title: 'Buscar' }]} />
      <h1 className={styles.pageTitle}>Buscar ayuda</h1>
      <HelpSearch key={helpSearchHref(query, filters)} initialQuery={query} filters={filters} />
      {searched ? (
        <div className={styles.results}>
          <form
            className={styles.filters}
            method="get"
            action={HELP_ROOT + '/buscar'}
            aria-label="Filtros de resultados"
          >
            <input name="q" type="hidden" value={query} />
            <label className={styles.filterField}>
              Categoría
              <select name="categoria" defaultValue={filters.categoria ?? ''}>
                <option value="">Todas</option>
                {Object.entries(HELP_CATEGORIES).map(([value, { title }]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              Audiencia
              <select name="audiencia" defaultValue={filters.audiencia ?? ''}>
                <option value="">Todas</option>
                {Object.entries(HELP_AUDIENCES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.filterField}>
              Tipo
              <select name="tipo" defaultValue={filters.tipo ?? ''}>
                <option value="">Todos</option>
                {Object.entries(HELP_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={styles.button}>
              Aplicar filtros
            </button>
            {clear && (
              <Link
                href={helpSearchHref(query)}
                prefetch={false}
                className={styles.inlineLink + ' self-center text-sm'}
              >
                Quitar filtros
              </Link>
            )}
          </form>
          {results.length ? (
            <section aria-label="Resultados de búsqueda">
              <p className="mb-3 text-sm text-muted-foreground" role="status">
                {results.length} {results.length === 1 ? 'resultado' : 'resultados'} para «{query}»
              </p>
              <ul className={styles.list}>
                {results.map((result) => (
                  <li key={result.slug} className={styles.listItem}>
                    <Link
                      href={helpArticleHref(result.slug)}
                      prefetch={false}
                      className={styles.listLink}
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {HELP_CATEGORIES[result.category].title} · {HELP_KINDS[result.kind]}
                        </p>
                        <h2 className="mt-1 text-lg font-semibold leading-snug">{result.title}</h2>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {result.excerpt}
                        </p>
                      </div>
                      <ArrowUpRight size={17} className="shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className={styles.panel}>
              <span className={styles.iconTile}>
                <SearchX size={20} aria-hidden="true" />
              </span>
              <h2 className="mt-2 text-lg font-semibold">
                No encontramos artículos para «{query}»
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Prueba una frase breve, como «código», «e.firma» o «descargar PDF»
                {clear ? ', o quita los filtros' : ''}.
              </p>
              <Link
                href={HELP_ROOT + '/guias'}
                prefetch={false}
                className={styles.arrowLink + ' mt-3 text-sm'}
              >
                Explorar guías por tema
              </Link>
            </section>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Escribe un tema como «código de verificación», «e.firma» o «solicitar cambios».
        </p>
      )}
    </div>
  );
}
