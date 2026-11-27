'use client';

import { Clock3, Pencil, Plus, Star, Trash2, Users, type LucideIcon } from 'lucide-react';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';
import { WorkspaceRowActions } from '@/components/WorkspaceRowActions';
import type { ContactGroupInfo } from '@/lib/contacts/groups';

export type ContactScope = 'all' | 'favorites' | 'follow-up' | 'group';

export function ContactAgendaSidebar({
  scope,
  groupId,
  counts,
  groups,
  groupsError,
  canCreateGroup,
  onScope,
  onGroup,
  onRetry,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
}: {
  scope: ContactScope;
  groupId?: string;
  counts: { all?: number; favorites?: number; followUp?: number };
  groups: (ContactGroupInfo & { count: number })[] | null;
  groupsError: boolean;
  canCreateGroup: boolean;
  onScope: (value: Exclude<ContactScope, 'group'>) => void;
  onGroup: (id: string) => void;
  onRetry: () => void;
  onCreateGroup: () => void;
  onEditGroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
}) {
  const sections: {
    title: string;
    items: {
      id: Exclude<ContactScope, 'group'>;
      label: string;
      count?: number;
      icon: LucideIcon;
      tone?: string;
    }[];
  }[] = [
    {
      title: 'Principal',
      items: [
        { id: 'all', label: 'Todos los contactos', icon: Users, count: counts.all },
        {
          id: 'favorites',
          label: 'Favoritos',
          icon: Star,
          count: counts.favorites,
          tone: 'text-amber-500',
        },
      ],
    },
    {
      title: 'Seguimiento',
      items: [{ id: 'follow-up', label: 'En seguimiento', icon: Clock3, count: counts.followUp }],
    },
  ];

  const entryState = (active: boolean) =>
    active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950';
  const focusClass =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35';
  const caption =
    'mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground';

  return (
    <ResponsiveSidebar
      label="Vistas y grupos de contactos"
      className="workspace-sidebar flex w-60 shrink-0 flex-col rounded-lg border border-slate-200 bg-white 2xl:w-64 dark:border-border dark:bg-card"
    >
      <nav
        aria-label="Vistas de la agenda"
        className="flex flex-col gap-3 xl:px-2.5 xl:pb-3 xl:pt-5"
      >
        {sections.map(({ title, items }) => (
          <section key={title} aria-label={title}>
            <p className={caption}>{title}</p>
            <div className="space-y-0.5">
              {items.map(({ id, label, count, icon: Icon, tone }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={scope === id}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors disabled:opacity-50 ${focusClass} ${entryState(scope === id)}`}
                  disabled={id !== 'all' && count === undefined}
                  onClick={() => onScope(id)}
                >
                  <Icon
                    size={16}
                    className={`shrink-0 ${scope === id ? '' : tone || ''}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">{label}</span>
                  {count !== undefined && <span className="text-xs tabular-nums">{count}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
        <section aria-label="Grupos de contactos">
          <p className={caption}>Grupos de contactos</p>
          <div className="space-y-0.5">
            {groups?.map((group) => (
              <div
                key={group.id}
                className={`flex min-w-0 items-center gap-1 rounded-md px-2.5 text-sm font-medium transition-colors ${entryState(groupId === group.id)}`}
              >
                <button
                  type="button"
                  aria-pressed={groupId === group.id}
                  title={group.name}
                  className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-left ${focusClass}`}
                  onClick={() => onGroup(group.id)}
                >
                  <span className="shrink-0 text-base leading-none" aria-hidden="true">
                    {group.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="text-xs tabular-nums">{group.count}</span>
                </button>
                <WorkspaceRowActions
                  title={`grupo ${group.name}`}
                  className="shrink-0"
                  actions={[
                    { label: 'Editar grupo', icon: Pencil, onSelect: () => onEditGroup(group.id) },
                    {
                      label: 'Eliminar grupo',
                      icon: Trash2,
                      iconClassName: 'text-destructive',
                      onSelect: () => onDeleteGroup(group.id),
                    },
                  ]}
                />
              </div>
            ))}
            {groupsError ? (
              <button
                type="button"
                onClick={onRetry}
                className="px-2.5 py-1 text-xs text-primary hover:underline"
              >
                Reintentar cargar grupos
              </button>
            ) : (
              !groups?.length && (
                <p className="px-2.5 py-1 text-xs text-muted-foreground">
                  {groups ? 'Sin grupos' : 'Cargando grupos…'}
                </p>
              )
            )}
          </div>
          <button
            type="button"
            onClick={onCreateGroup}
            disabled={!canCreateGroup}
            className={`mt-2 flex w-full items-center gap-2.5 rounded-md border border-dashed border-primary/30 px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-50 ${focusClass}`}
          >
            <Plus size={15} className="shrink-0" aria-hidden="true" /> Crear grupo
          </button>
        </section>
      </nav>
    </ResponsiveSidebar>
  );
}
