-- Repeat the phase/version/actor prerequisites at the canonical provider ledger,
-- under a row lock. A browser-side check alone cannot authorize a signature.
CREATE OR REPLACE FUNCTION public.case_signature_transition_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.case_files; d public.documentos; binding public.case_file_documents; policy jsonb;
BEGIN
 IF NEW.action_type<>'signature' OR NEW.status NOT IN ('claimed','committed') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='committed' THEN RETURN NEW; END IF;
 FOR c IN SELECT instance.* FROM public.case_files instance WHERE instance.runtime_version=1 AND EXISTS(SELECT 1 FROM public.case_file_documents b WHERE b.case_file_id=instance.id AND b.source_document_id=NEW.document_id) ORDER BY instance.id FOR UPDATE LOOP
  IF c.status NOT IN ('ready_to_sign','signing') THEN RAISE EXCEPTION 'CASE_SIGNATURE_NOT_READY'; END IF;
  SELECT snapshot#>'{requirements_schema,reviewPolicy}' INTO policy FROM public.case_file_template_versions WHERE id=c.template_version_id;
  IF (policy#>>'{approval,enabled}')::boolean IS TRUE AND (c.review_approval->>'decision' IS DISTINCT FROM 'approved' OR c.review_approval->>'actorId' IS DISTINCT FROM c.runtime_assignments->>'approver' OR NOT public.case_actor_eligible(c.workspace_id,c.owner_user_id,(c.runtime_assignments->>'approver')::uuid,policy#>>'{approval,role}')) THEN RAISE EXCEPTION 'CASE_SIGNATURE_NOT_READY'; END IF;
  SELECT * INTO d FROM public.documentos WHERE id=NEW.document_id;
  FOR binding IN SELECT * FROM public.case_file_documents WHERE case_file_id=c.id AND source_document_id=d.id LOOP
   IF binding.validation_result->>'sourceVersionId' IS DISTINCT FROM NEW.document_version_id::text OR binding.sha256_hash IS DISTINCT FROM d.file_hash_sha256 THEN RAISE EXCEPTION 'CASE_SIGNATURE_NOT_READY'; END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END; $$;
