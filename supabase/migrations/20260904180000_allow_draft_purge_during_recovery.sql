-- Intentionally left without DDL.
--
-- This migration had not been applied to the linked project. Its original
-- SECURITY DEFINER function used a mutable search_path. The functional change
-- was moved to 20260905190000_allow_draft_purge_during_recovery_secure.sql so
-- migration history remains ordered without deploying the unsafe definition.

DO $$
BEGIN
  PERFORM 1;
END;
$$;
