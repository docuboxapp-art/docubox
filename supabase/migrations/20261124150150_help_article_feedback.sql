begin;

create table public.help_article_feedback (
  article_slug text not null check (article_slug ~ '^[a-z0-9][a-z0-9-]{0,89}$'),
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  helpful boolean not null,
  reason text check (
    reason is null or (not helpful and reason in ('missing_answer', 'steps_changed', 'incomplete', 'unresolved'))
  ),
  updated_at timestamptz not null default now(),
  primary key (article_slug, voter_hash)
);

comment on table public.help_article_feedback is
  'Anonymous bounded help article ratings. No contact information or document identifiers.';

alter table public.help_article_feedback enable row level security;
revoke all on table public.help_article_feedback from public, anon, authenticated;
grant select, insert, update on table public.help_article_feedback to service_role;

commit;
