-- Read-only catalog queries used for the pre-encryption snapshot.
-- Project: kbjejiclhgjmiasauxyr

select version();
select pg_size_pretty(pg_database_size(current_database()));
select count(*) from public.document_encryption_metadata;

select c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity,
       c.relacl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('document_encryption_metadata', 'document_participant_deks',
                    'v_documents_missing_participant_deks');

select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('document_encryption_metadata', 'document_participant_deks')
order by table_name, ordinal_position;

select n.nspname, c.relname, con.conname, con.contype,
       pg_get_constraintdef(con.oid, true)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('document_encryption_metadata', 'document_participant_deks');

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('document_encryption_metadata', 'document_participant_deks');

select * from pg_policies
where schemaname = 'public'
  and tablename in ('document_encryption_metadata', 'document_participant_deks');

select c.relname, t.tgname, pg_get_triggerdef(t.oid, true)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('document_participant_deks', 'document_versions')
  and not t.tgisinternal;

select p.oid::regprocedure, pg_get_functiondef(p.oid), p.proacl,
       p.prosecdef, pg_get_userbyid(p.proowner)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('generate_participant_dek_wrap',
                    'sync_encryption_metadata_dek_counts',
                    'is_workspace_member_for_encryption',
                    'prevent_frozen_document_version_mutation');
