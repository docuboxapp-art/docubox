-- Recover private Storage object paths from legacy signed/public URLs.
-- Only rows whose object still exists in the documents bucket are updated.
with document_candidates as (
  select
    d.id,
    case
      when d.file_url like '%/storage/v1/object/sign/documents/%'
        then split_part(split_part(d.file_url, '/storage/v1/object/sign/documents/', 2), '?', 1)
      when d.file_url like '%/storage/v1/object/authenticated/documents/%'
        then split_part(split_part(d.file_url, '/storage/v1/object/authenticated/documents/', 2), '?', 1)
      when d.file_url like '%/storage/v1/object/public/documents/%'
        then split_part(split_part(d.file_url, '/storage/v1/object/public/documents/', 2), '?', 1)
      else null
    end as object_path
  from public.documentos d
  where d.storage_path is null
    and d.file_url is not null
    and d.file_hash_sha256 ~ '^[0-9a-fA-F]{64}$'
)
update public.documentos d
set storage_path = candidate.object_path
from document_candidates candidate
where d.id = candidate.id
  and nullif(candidate.object_path, '') is not null
  and exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'documents'
      and object.name = candidate.object_path
  );

with version_candidates as (
  select
    version.id,
    case
      when version.file_url like '%/storage/v1/object/sign/documents/%'
        then split_part(split_part(version.file_url, '/storage/v1/object/sign/documents/', 2), '?', 1)
      when version.file_url like '%/storage/v1/object/authenticated/documents/%'
        then split_part(split_part(version.file_url, '/storage/v1/object/authenticated/documents/', 2), '?', 1)
      when version.file_url like '%/storage/v1/object/public/documents/%'
        then split_part(split_part(version.file_url, '/storage/v1/object/public/documents/', 2), '?', 1)
      else null
    end as object_path
  from public.document_versions version
  where version.storage_path is null
    and version.file_url is not null
    and version.sha256 ~ '^[0-9a-fA-F]{64}$'
)
update public.document_versions version
set storage_path = candidate.object_path
from version_candidates candidate
where version.id = candidate.id
  and nullif(candidate.object_path, '') is not null
  and exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'documents'
      and object.name = candidate.object_path
  );
