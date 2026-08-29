alter table public.participation_responses
  add column if not exists signature_method text,
  add column if not exists signature_stamp_style text,
  add column if not exists signature_hash text,
  add column if not exists signature_ip text,
  add column if not exists signature_metadata jsonb not null default '{}'::jsonb;

create index if not exists participation_responses_signed_document_idx
  on public.participation_responses (documento_id, firma_completada_at)
  where firma_completada = true;
