-- Emergency lockdown for identity, biometric and mobile-session data.
-- Keep this migration small so the confirmed public exposure is closed before
-- the broader integrity migration runs.

DROP POLICY IF EXISTS "public_insert_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS "public_select_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS "public_update_enrollment_tokens" ON public.enrollment_tokens;
DROP POLICY IF EXISTS enrollment_tokens_emergency_service_all ON public.enrollment_tokens;
CREATE POLICY enrollment_tokens_emergency_service_all ON public.enrollment_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS "public_select_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS "public_update_enrollment_results" ON public.enrollment_results;
DROP POLICY IF EXISTS anon_read_by_session_id ON public.enrollment_results;
DROP POLICY IF EXISTS enrollment_results_emergency_service_all ON public.enrollment_results;
CREATE POLICY enrollment_results_emergency_service_all ON public.enrollment_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_curp_validations" ON public.curp_validations;
DROP POLICY IF EXISTS "public_select_curp_validations" ON public.curp_validations;
DROP POLICY IF EXISTS curp_validations_emergency_service_all ON public.curp_validations;
CREATE POLICY curp_validations_emergency_service_all ON public.curp_validations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_serial_validations" ON public.serial_validations;
DROP POLICY IF EXISTS "public_select_serial_validations" ON public.serial_validations;
DROP POLICY IF EXISTS serial_validations_emergency_service_all ON public.serial_validations;
CREATE POLICY serial_validations_emergency_service_all ON public.serial_validations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
DROP POLICY IF EXISTS "public_select_nubarium_ocr_logs" ON public.nubarium_ocr_logs;
DROP POLICY IF EXISTS nubarium_ocr_logs_emergency_service_all ON public.nubarium_ocr_logs;
CREATE POLICY nubarium_ocr_logs_emergency_service_all ON public.nubarium_ocr_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_insert_face_comparison_logs" ON public.face_comparison_logs;
DROP POLICY IF EXISTS "public_select_face_comparison_logs" ON public.face_comparison_logs;
DROP POLICY IF EXISTS face_comparison_logs_emergency_service_all ON public.face_comparison_logs;
CREATE POLICY face_comparison_logs_emergency_service_all ON public.face_comparison_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_own_id_capture_logs" ON public.id_capture_logs;
DROP POLICY IF EXISTS "service_role_manage_id_capture_logs" ON public.id_capture_logs;
DROP POLICY IF EXISTS id_capture_logs_emergency_service_all ON public.id_capture_logs;
CREATE POLICY id_capture_logs_emergency_service_all ON public.id_capture_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_can_read_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
DROP POLICY IF EXISTS "public_can_update_mobile_upload_sessions_by_token" ON public.mobile_upload_sessions;
DROP POLICY IF EXISTS mobile_upload_sessions_emergency_service_all ON public.mobile_upload_sessions;
CREATE POLICY mobile_upload_sessions_emergency_service_all ON public.mobile_upload_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users_manage_own_otps" ON public.signature_otps;
DROP POLICY IF EXISTS signature_otps_emergency_service_all ON public.signature_otps;
CREATE POLICY signature_otps_emergency_service_all ON public.signature_otps
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mobile_uploads_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "mobile_uploads_auth_select" ON storage.objects;
