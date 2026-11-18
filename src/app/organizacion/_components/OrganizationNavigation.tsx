'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { organizationSectionGroups, type OrganizationSection } from '@/lib/organization/sections';
import {
  filterOrganizationSections,
  organizationRouteMatches,
} from '@/lib/organization/navigation';
import OrganizationSectionIcon from './OrganizationSectionIcon';

function SectionLinks({
  items,
  pathname,
  query,
  onQueryChange,
  mobile = false,
}: {
  items: readonly OrganizationSection[];
  pathname: string;
  query: string;
  onQueryChange: (query: string) => void;
  mobile?: boolean;
}) {
  const filtered = filterOrganizationSections(items, query);
  return (
    <>
      <div className="organization-nav-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          aria-label="Buscar sección"
          placeholder="Buscar sección..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="Limpiar búsqueda de secciones"
            onClick={() => onQueryChange('')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className={mobile ? 'sm:grid sm:grid-cols-2 sm:gap-x-5' : ''}>
        {organizationSectionGroups.map((group) => {
          const links = filtered.filter((item) => item.group === group.key);
          if (!links.length) return null;
          return (
            <div className="organization-nav-group" key={group.key}>
              <p className="organization-nav-group-label">{group.label}</p>
              {links.map((item) => {
                const active = organizationRouteMatches(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    title={item.description}
                    aria-current={active ? 'page' : undefined}
                    onClick={(event) => {
                      if (mobile) {
                        const details = event.currentTarget.closest('details');
                        if (details) details.open = false;
                      }
                    }}
                    className="organization-nav-link"
                  >
                    <OrganizationSectionIcon section={item.key} className="shrink-0" />
                    <span className="flex-1 min-w-0">{item.label}</span>
                    {active && <ChevronRight size={13} className="shrink-0" aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="px-2 py-5 text-sm text-muted-foreground" role="status">
          No hay secciones que coincidan.
        </p>
      )}
    </>
  );
}

export default function OrganizationNavigation({
  items,
  pathname,
}: {
  items: readonly OrganizationSection[];
  pathname: string;
}) {
  const [query, setQuery] = useState('');
  const current = items
    .filter((item) => organizationRouteMatches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <aside className="organization-sidebar bg-background border-r border-border">
      <details
        className="organization-mobile-navigation lg:hidden"
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.open = false;
        }}
      >
        <summary>
          <span>Secciones de la organización</span>
          <span className="flex items-center gap-2 text-primary font-medium">
            {current?.label || 'Elegir sección'}
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </summary>
        <nav aria-label="Secciones de la organización" className="p-4">
          <SectionLinks
            items={items}
            pathname={pathname}
            query={query}
            onQueryChange={setQuery}
            mobile
          />
        </nav>
      </details>
      <nav
        aria-label="Administración de la organización"
        className="hidden lg:block sticky top-[104px] max-h-[calc(100dvh-104px)] overflow-y-auto"
      >
        <SectionLinks items={items} pathname={pathname} query={query} onQueryChange={setQuery} />
      </nav>
    </aside>
  );
}
