create table if not exists public.document_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_document_id uuid not null references public.documentos(id) on delete restrict,
  source_version_id uuid references public.document_versions(id) on delete set null,
  target_document_id uuid not null references public.documentos(id) on delete cascade,
  target_version_id uuid references public.document_versions(id) on delete set null,
  relation_type text not null default 'derived_from',
  source_sha256 text not null,
  target_initial_sha256 text not null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint document_relations_distinct_documents
    check (source_document_id <> target_document_id),
  constraint document_relations_type_check
    check (relation_type in ('copy', 'derived_from', 'reference', 'supersedes', 'related')),
  constraint document_relations_source_hash_check
    check (source_sha256 ~ '^[0-9a-fA-F]{64}$'),
  constraint document_relations_target_hash_check
    check (target_initial_sha256 ~ '^[0-9a-fA-F]{64}$')
);

create unique index if not exists document_relations_unique_derivation
  on public.document_relations (
    source_document_id,
    source_version_id,
    target_document_id,
    relation_type
  ) nulls not distinct;

create index if not exists document_relations_workspace_created_idx
  on public.document_relations (workspace_id, created_at desc);

create index if not exists document_relations_source_idx
  on public.document_relations (source_document_id, source_version_id);

create index if not exists document_relations_target_idx
  on public.document_relations (target_document_id);

alter table public.document_relations enable row level security;

drop policy if exists "document_relations_read" on public.document_relations;
create policy "document_relations_read"
  on public.document_relations
  for select
  to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (
      public.can_read_documento(source_document_id)
      or public.can_read_documento(target_document_id)
    )
  );

revoke all on table public.document_relations from anon, authenticated;

comment on table public.document_relations is
  'Immutable lineage between a source document/version and a derived or referenced document.';

comment on column public.document_relations.source_sha256 is
  'SHA-256 of the exact source bytes selected by the user.';

comment on column public.document_relations.target_initial_sha256 is
  'Initial SHA-256 of the derived document before any subsequent modification.';

;
