-- Preserve the evidence rendered beside the QR at PDF generation time.
-- Published form versions are immutable, while response-level evidence is captured once.
ALTER TABLE public.form_responses
  ADD COLUMN IF NOT EXISTS pdf_evidence_snapshot jsonb;
