-- Keep the launcher's signature choice bound to the individual invitation code.
-- Existing invitations used autograph signatures before this choice was offered.
ALTER TABLE public.form_public_invitees
  ADD COLUMN IF NOT EXISTS signature_type text NOT NULL DEFAULT 'autografa_digital';

ALTER TABLE public.form_public_invitees
  ADD CONSTRAINT form_public_invitees_signature_type_check
  CHECK (signature_type IN ('click_sign', 'autografa_digital', 'efirma_sat'));
