-- Public form access is proven by its separately delivered code and a
-- subsequent biometric capture, so failed code attempts may precede signup.
alter table public.form_public_code_attempts
  alter column user_id drop not null;

create index if not exists form_public_code_attempts_ip_recent_idx
  on public.form_public_code_attempts (ip_hash, created_at desc);

alter table public.form_public_invitees
  add column if not exists code_lookup text,
  add column if not exists code_hash text,
  add column if not exists code_ciphertext text;

create unique index if not exists form_public_invitees_code_lookup_key
  on public.form_public_invitees (code_lookup)
  where code_lookup is not null;
