-- Explicitly keep provider configuration backend-only while satisfying the
-- database linter that the RLS posture is deliberate.
CREATE POLICY psc_providers_backend_only ON public.psc_providers
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

INSERT INTO public.psc_providers (
  provider_key, display_name, provider_type, environment, enabled,
  capabilities, health_status, endpoint_reference, secret_reference, metadata
)
VALUES (
  'configured-psc', 'PSC productivo configurado', 'psc', 'production', false,
  '["timestamp","nom151","validate","download_evidence"]'::JSONB,
  'not_configured', 'CERTIFICA_PSC_BASE_URL', 'CERTIFICA_PSC_API_TOKEN',
  '{"requires_backend_secret":true,"legal_validity_requires_health_check":true}'::JSONB
)
ON CONFLICT (provider_key) DO UPDATE SET
  endpoint_reference = EXCLUDED.endpoint_reference,
  secret_reference = EXCLUDED.secret_reference,
  metadata = EXCLUDED.metadata;

CREATE INDEX IF NOT EXISTS idx_certification_cases_created_by ON public.certification_cases(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_cases_source_document ON public.certification_cases(source_document_id);
CREATE INDEX IF NOT EXISTS idx_certification_cases_existing_engine ON public.certification_cases(existing_document_certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_batches_workspace ON public.certification_batches(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_batches_created_by ON public.certification_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_batch_items_workspace ON public.certification_batch_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_batch_items_case ON public.certification_batch_items(certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_events_workspace ON public.certification_case_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_events_actor ON public.certification_case_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_certification_declarations_workspace ON public.certification_declarations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_declarations_actor ON public.certification_declarations(accepted_by);
CREATE INDEX IF NOT EXISTS idx_certification_files_created_by ON public.certification_files(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_evidences_workspace ON public.certification_evidences(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_evidences_file ON public.certification_evidences(file_id);
CREATE INDEX IF NOT EXISTS idx_certification_evidences_transaction ON public.certification_evidences(provider_transaction_id);
CREATE INDEX IF NOT EXISTS idx_certification_integrity_case ON public.certification_integrity_checks(certification_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_integrity_workspace ON public.certification_integrity_checks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_integrity_checked_by ON public.certification_integrity_checks(checked_by);
CREATE INDEX IF NOT EXISTS idx_certification_manifests_workspace ON public.certification_manifests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_metadata_workspace ON public.certification_metadata(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_metadata_created_by ON public.certification_metadata(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_provider_case ON public.certification_provider_transactions(certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_provider_workspace ON public.certification_provider_transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_public_links_case ON public.certification_public_links(certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_public_links_workspace ON public.certification_public_links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_public_links_created_by ON public.certification_public_links(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_signatures_workspace ON public.certification_signatures(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_custody_workspace ON public.certification_custody_policies(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_custody_created_by ON public.certification_custody_policies(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_credit_case ON public.certification_credit_reservations(certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_ledger_case ON public.certification_ledger_entries(certification_id);
CREATE INDEX IF NOT EXISTS idx_certification_ledger_reservation ON public.certification_ledger_entries(reservation_id);
CREATE INDEX IF NOT EXISTS idx_certification_ledger_created_by ON public.certification_ledger_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_certification_verification_workspace ON public.certification_verification_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certification_webhooks_workspace ON public.certification_webhooks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_certification_webhooks_created_by ON public.certification_webhooks(created_by);
