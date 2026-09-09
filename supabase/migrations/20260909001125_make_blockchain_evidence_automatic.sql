-- Blockchain evidence is automatic for every completed document, like NOM-151.
-- It remains subject to server-side provider availability, never to client input.
ALTER TABLE public.documentos
  ALTER COLUMN blockchain_evidence_enabled SET DEFAULT true;

ALTER TABLE public.workspaces
  ALTER COLUMN blockchain_evidence_enabled SET DEFAULT true;

UPDATE public.documentos
SET blockchain_evidence_enabled = true
WHERE blockchain_evidence_enabled IS DISTINCT FROM true;

UPDATE public.workspaces
SET blockchain_evidence_enabled = true
WHERE blockchain_evidence_enabled IS DISTINCT FROM true;
