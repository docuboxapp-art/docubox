-- WP-NOM151-PRODUCTION-TRUST
-- Adds public trust evidence without changing or regenerating the original
-- provider artifact. Productive trust is an explicit, fail-closed state.

ALTER TABLE public.nom151_constancias_doc
  ADD COLUMN IF NOT EXISTS production_trusted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trust_bundle_version text,
  ADD COLUMN IF NOT EXISTS trust_root_fingerprint text,
  ADD COLUMN IF NOT EXISTS chain_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS certificate_valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_key_usage text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS certificate_extended_key_usage text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS certificate_policy_oids text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS tst_policy_oid text;

ALTER TABLE public.nom151_constancias_doc
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_environment_check,
  ADD CONSTRAINT nom151_constancias_doc_environment_check
    CHECK (environment IS NULL OR environment IN ('development','production','sandbox','unknown')),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_trust_root_fingerprint_check,
  ADD CONSTRAINT nom151_constancias_doc_trust_root_fingerprint_check
    CHECK (trust_root_fingerprint IS NULL OR trust_root_fingerprint ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS nom151_constancias_doc_production_trust_check,
  ADD CONSTRAINT nom151_constancias_doc_production_trust_check
    CHECK (
      production_trusted = false
      OR (
        environment = 'production'
        AND verification_status = 'verified'
        AND trust_bundle_version IS NOT NULL
        AND trust_root_fingerprint IS NOT NULL
      )
    );

CREATE INDEX IF NOT EXISTS idx_nom151_production_trusted
  ON public.nom151_constancias_doc(documento_id, production_trusted, verified_at DESC)
  WHERE production_trusted = true;

COMMENT ON COLUMN public.nom151_constancias_doc.production_trusted IS
  'True only after technical verification plus explicit production environment, endpoint and pinned PSC root validation.';
COMMENT ON COLUMN public.nom151_constancias_doc.trust_bundle_version IS
  'Version of the explicitly onboarded public PSC trust bundle used for verification.';
COMMENT ON COLUMN public.nom151_constancias_doc.chain_fingerprints IS
  'Ordered public SHA-256 certificate fingerprints observed/used during chain validation.';
