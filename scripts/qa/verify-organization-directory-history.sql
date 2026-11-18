-- Synthetic, transaction-scoped metadata only. No files, invitations or signatures.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $fixture$
DECLARE ws uuid; actor uuid; person_id uuid; document_id uuid;
BEGIN
  SELECT id,owner_id INTO ws,actor FROM public.workspaces WHERE workspace_type='business' LIMIT 1;
  INSERT INTO public.organization_directory_people(workspace_id,full_name,email,person_type,relationship_type,created_by)
  VALUES(ws,'QA rollback history','history-rollback@example.invalid','individual','collaborator',actor) RETURNING id INTO person_id;
  INSERT INTO public.documentos(documento_id,owner_id,file_name,file_hash_sha256,nombre,workspace_id,participantes)
  VALUES('QA-HISTORY-'||gen_random_uuid(),actor,'qa-history.pdf',repeat('0',64),'QA rollback history',ws,jsonb_build_array(jsonb_build_object('email','HISTORY-ROLLBACK@example.invalid'))) RETURNING id INTO document_id;
  PERFORM set_config('qa.history_workspace',ws::text,true);
  PERFORM set_config('qa.history_person',person_id::text,true);
  PERFORM set_config('qa.history_document',document_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
END $fixture$;
SET LOCAL ROLE authenticated;
DO $assert$
DECLARE ws uuid:=current_setting('qa.history_workspace')::uuid; person_id uuid:=current_setting('qa.history_person')::uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.get_organization_person_document_history(ws,person_id,0,10) WHERE id=current_setting('qa.history_document')::uuid AND total_count=1) THEN
    RAISE EXCEPTION 'Directory history did not return the scoped participant document';
  END IF;
  IF EXISTS(SELECT 1 FROM public.get_organization_person_document_history(gen_random_uuid(),person_id,0,10)) THEN RAISE EXCEPTION 'Foreign workspace leaked history'; END IF;
  IF EXISTS(SELECT 1 FROM public.get_organization_person_document_history(ws,gen_random_uuid(),0,10)) THEN RAISE EXCEPTION 'Foreign person leaked history'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
  IF EXISTS(SELECT 1 FROM public.get_organization_person_document_history(ws,person_id,0,10)) THEN RAISE EXCEPTION 'Nonmember leaked history'; END IF;
END $assert$;
ROLLBACK;
