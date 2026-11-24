'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useId, useState, useTransition } from 'react';
import {
  HELP_CATEGORIES,
  HELP_ROOT,
  helpArticleHref,
  type HelpFilters,
  type HelpSearchResult,
} from '@/lib/help/model';
import { cleanHelpQuery, HELP_QUERY_LIMIT, helpSearchHref } from '@/lib/help/query';
import styles from '../help.module.css';

type Suggestions =
  { query: string; state: 'ready'; items: HelpSearchResult[] } | { query: string; state: 'error' };

export default function HelpSearch({
  initialQuery = '',
  filters = {},
}: {
  initialQuery?: string;
  filters?: HelpFilters;
}) {
  const router = useRouter();
  const inputId = useId();
  const menuId = inputId + '-suggestions';
  const statusId = inputId + '-status';
  const [value, setValue] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<Suggestions>();
  const [empty, setEmpty] = useState(false);
  const [pending, startTransition] = useTransition();
  const query = cleanHelpQuery(value);
  const { categoria, audiencia, tipo } = filters;
  const dropdown = open && query.length >= 2 && !pending;
  const latest = suggestions?.query === query ? suggestions : undefined;
  const items = latest?.state === 'ready' ? latest.items : [];
  const hasItems = dropdown && items.length > 0;

  useEffect(() => {
    if (!dropdown) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/centro-ayuda/buscar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, categoria, audiencia, tipo }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('HELP_SUGGESTIONS_UNAVAILABLE');
        const { results } = (await response.json()) as { results: HelpSearchResult[] };
        if (!controller.signal.aborted) setSuggestions({ query, state: 'ready', items: results });
      } catch {
        if (!controller.signal.aborted) setSuggestions({ query, state: 'error' });
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dropdown, query, categoria, audiencia, tipo]);

  useEffect(() => {
    if (hasItems && active >= 0) {
      document.getElementById(menuId + '-' + active)?.scrollIntoView({ block: 'nearest' });
    }
  }, [active, hasItems, menuId]);

  function navigate(href: string) {
    setOpen(false);
    setActive(-1);
    startTransition(() => router.push(href));
  }

  return (
    <form
      role="search"
      action={HELP_ROOT + '/buscar'}
      method="get"
      className={styles.searchBox}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (query.length < 2) {
          setEmpty(true);
          return;
        }
        navigate(helpSearchHref(query, { categoria, audiencia, tipo }));
      }}
    >
      {Object.entries(filters).map(([key, filter]) =>
        filter ? <input key={key} type="hidden" name={key} value={filter} /> : null
      )}
      <label htmlFor={inputId} className="sr-only">
        Buscar en el Centro de ayuda
      </label>
      <div className={styles.searchField}>
        <Search size={21} aria-hidden="true" />
        <input
          className={styles.searchInput}
          id={inputId}
          name="q"
          type="search"
          role="combobox"
          autoComplete="off"
          placeholder="Busca cómo firmar o enviar un documento"
          maxLength={HELP_QUERY_LIMIT * 2}
          value={value}
          aria-expanded={hasItems}
          aria-autocomplete="list"
          aria-controls={hasItems ? menuId : undefined}
          aria-activedescendant={hasItems && active >= 0 ? menuId + '-' + active : undefined}
          aria-describedby={empty ? statusId : undefined}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
            setEmpty(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              if (items.length) {
                const next =
                  event.key === 'ArrowDown'
                    ? (active + 1) % items.length
                    : active <= 0
                      ? items.length - 1
                      : active - 1;
                setActive(next);
              }
            } else if (event.key === 'Enter' && hasItems && items[active]) {
              event.preventDefault();
              navigate(helpArticleHref(items[active].slug));
            }
          }}
        />
        <button
          type="submit"
          className={styles.button + ' ' + styles.primaryButton}
          disabled={pending}
        >
          {pending && (
            <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" />
          )}
          Buscar
        </button>
      </div>
      {empty && (
        <p id={statusId} className="mt-2 text-sm text-red-600 dark:text-red-300" role="status">
          Escribe un tema de ayuda sin códigos ni contraseñas.
        </p>
      )}
      {dropdown && (
        <div className={styles.searchMenu}>
          {hasItems ? (
            <>
              <p className="px-3 pt-2 text-xs text-muted-foreground">Sugerencias</p>
              <ul role="listbox" id={menuId} aria-label="Sugerencias de artículos" className="p-1">
                {items.map((item, index) => (
                  <li key={item.slug} role="presentation">
                    <Link
                      href={helpArticleHref(item.slug)}
                      role="option"
                      id={menuId + '-' + index}
                      aria-selected={index === active}
                      tabIndex={-1}
                      prefetch={false}
                      className={styles.suggestion}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                        {item.title}{' '}
                        <ArrowUpRight
                          size={14}
                          className="shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {HELP_CATEGORIES[item.category].title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
              {latest?.state === 'error'
                ? 'Las sugerencias no están disponibles. Pulsa Buscar para continuar.'
                : latest?.state === 'ready'
                  ? 'Sin sugerencias. Prueba con una frase más corta.'
                  : 'Buscando sugerencias…'}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
