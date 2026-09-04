# Matriz de reconciliación de migraciones

Generada: 2026-08-30T02:39:43.319Z

La clasificación es fail closed. La presencia de un objeto por nombre no prueba columnas, definición, backfills ni datos históricos.

| Migración | Git | Historial remoto | Clasificación | Evidencia |
|---|---:|---:|---|---|
| 20260323181212_workspaces.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260323192000_nubarium_validations.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260323210000_enrollment_tokens.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260323230000_enrollment_results.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260324000000_nubarium_ocr_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260324010000_face_comparison_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260324063000_enrollment_realtime_fix.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260324070000_enrollment_results_rls_read.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260324090000_user_registration_workspace_subscription.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260325030000_user_verification_status.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260325190000_dashboard_layout.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260325200000_cleanup_users.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260325201000_access_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260326010000_fix_verification_status.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326020000_fix_phone_in_trigger_and_verification.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326030000_fix_biometric_and_document_tables.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326040000_etiquetas_table.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326050000_rol_table.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326060000_enrollment_started_at.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260326070000_enrollment_device_tracking.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260326180000_mobile_upload_sessions.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260326190000_fix_mobile_upload_rls.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260326200000_mobile_upload_storage.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326210000_documentos_table.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260326220000_roles_documento_table.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260329200000_workflow_flows_table.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260329210000_user_favorites.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260329220000_document_security_settings.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260329230000_security_audit_log.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260329240000_fix_security_settings_constraint.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260330070000_documentos_participantes_campos.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260330080000_docubox_documents_and_evidence.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260330080100_docubox_audit_trail.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260330080200_docubox_integrity_log.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260330090000_unregistered_participants.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260330100000_document_draft_progress.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260330110000_contacts_table.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405020000_contacts_etiqueta_rol.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405060000_profile_extended_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405070000_firma_autografa_url.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405080000_workspace_invite_code_and_personal.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260405090000_security_sessions_and_activity.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405100000_efirma_profile_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260405110000_recreate_access_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260406020000_scan_security_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260406030000_document_metadata.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260406070000_create_documents_bucket.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260406080000_restrict_documents_bucket_read.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260406090000_owner_only_update_delete_and_metadata_fix.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260406200000_documentos_missing_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260407020000_documentos_carpeta_id.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260413210000_user_view_preferences.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260414070000_add_custom_filters_to_view_preferences.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260414080000_add_active_filters_to_view_preferences.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260424150000_documentos_workspace_id.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424160000_seed_free_plan.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424161000_fix_setup_function_free_plan.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424170000_update_subscription_function.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424180000_fix_documentos_sin_workspace.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424190000_delete_documentos_sin_workspace.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260424200000_user_nav_mode_preference.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260424235000_documentos_cancelacion_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260426200000_add_missing_documentos_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260426210000_ensure_user_workspace_and_fix_documents.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260426220000_participaciones_rls_and_api.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260426230000_fix_subscriptions_and_listar_debug.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260426240000_add_grid_columns_config.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260428050000_carpetas_descripcion_tipo.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260429191500_carpetas_grupo_tipo_documento.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260501032200_unregistered_participants_tipo_persona.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260501200000_participantes_sub_estado.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260502020000_documentos_otro_tipo_documento.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260507050000_notifications_table.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260507070000_document_chat_messages.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260507100000_fix_document_viewer_access.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260507110000_set_initial_participation_status_en_revision.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260507200000_document_notes.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260508070000_document_activity_log.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260509230000_participation_responses.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260511100000_plantillas_module.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260511200000_form_builder_module.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260511230000_signature_evidence_table.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260512010000_signature_otps.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260512060000_documentos_en_espera_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260512190000_mobile_upload_sessions_metadata.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260512200000_id_capture_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513020000_update_document_completado.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513030000_update_participante_estado.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513040000_efirma_evidence_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513100000_backfill_participant_user_ids.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513200000_force_rerun_backfill_participant_user_ids.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260513220000_fix_participant_backfill_v3.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514020000_update_user_profile_imssjose.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260514030000_fix_user_profile_imssjose.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260514100000_expiry_check_cron.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514200000_user_module_preferences.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514210000_id_capture_store_images.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514220000_device_login_history.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514230000_lucia_sessions_messages.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514231000_extend_setup_function_full_profile.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260514240000_email_verification_tokens.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514250000_ai_document_chunks_and_logs.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260514260000_match_document_chunks_rpc.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260517010000_efirma_sat_evidence.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260518030000_nom151_constancias.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518040000_xml_generation_queue.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260518050000_xml_evidence_extra_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518060000_signature_evidence_missing_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518070000_geocode_cache.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518080000_signature_evidence_city_country_code.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518085900_document_signature_seals.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518090000_seal_pdf_crypto_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518100000_nubarium_result_on_signature_evidence.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260518200000_totp_2fa.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519120000_participation_order_schema.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519130000_totp_purpose_column.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519200000_webauthn_module.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519210000_webauthn_challenges.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519220000_access_logs_auth_method_geocoding.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260519230000_login_otps.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260521030000_add_video_columns.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260521040000_add_attempt_tracking.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260521050000_fix_nom151_xml_documentos.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260524030000_pending_tasks_module.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260524040000_automation_rules.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260524050000_task_details_tables.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260527230000_firma_eventos.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260601180000_document_metaetiquetas.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260601200000_proteccion_participacion.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260602060000_add_column_widths_to_view_preferences.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260605040000_contact_notes_and_custom_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260610210000_plantillas_full_fields.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260621000000_plantillas_coordinates_and_draft.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260709220000_efirma_stamp_style.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260709230000_autografa_stamp_style.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260710002000_efirma_stamp_style_fix.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260710010000_click_sign_stamp_style.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260802010000_formularios_firmables.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260803010000_expedientes_digitales.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260803020000_identity_verification_engine.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260805010000_cryptographic_certification_engine.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260808010000_docubox_notifica.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260808020000_credit_titles.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260808030000_bulk_signatures.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260808040000_public_verification_center.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260808115900_emergency_public_policy_lockdown.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260808120000_security_integrity_hardening.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260815120000_organization_governance_foundation.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260815160000_organization_governance_phase2.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260815190000_organization_advanced_administration.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260815220000_organization_continuity_hardening.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260815230000_organization_member_detail.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816010000_organization_invitation_lifecycle.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816020000_organization_step_up_authentication.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816030000_organization_structure_governance.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816040000_organization_directory_authority_hardening.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816050000_organization_workflow_resource_runtime.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816060000_organization_security_backend_boundary.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816070000_organization_branding_backend_boundary.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816080000_organization_audit_chain_and_billing_boundary.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816090000_organization_profile_kyb.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816100000_organization_document_governance.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816110000_colabora_entitlements_and_access.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816120000_colabora_tasks_and_reviews.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816130000_colabora_spaces_and_requests.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816140000_colabora_external_and_automation.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816150000_colabora_request_external_access.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816160000_colabora_room_resource_order.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816170000_colabora_usage_metering.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816180000_colabora_request_file_incorporation.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816190000_colabora_automation_event_queue.sql | sí | no | UNKNOWN | Incluye DML/backfill; el esquema actual no demuestra por sí solo que el efecto de datos ocurrió. |
| 20260816200000_colabora_document_integration.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816210000_colabora_automation_side_effect_idempotency.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260816220000_colabora_commercial_tiers.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260816225730; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260816225730_colabora_commercial_tiers.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260816225740_webauthn_qr_tokens_rls.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260816225855_document_dek_diagnostics_security.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260816230000_webauthn_qr_tokens_rls.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260816225740; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260816240000_document_dek_diagnostics_security.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260816225855; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817044200_docubox_certifica_phase1.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817045846; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817045846_docubox_certifica_phase1.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817050013_docubox_certifica_hardening.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817050628_docubox_certifica_api_hardening.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817051500_docubox_certifica_hardening.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817050013; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817054000_docubox_certifica_api_hardening.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817050628; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817063837_document_internal_derivations.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817180845; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817180845_document_internal_derivations.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817183318_backfill_legacy_document_storage_paths.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817183358; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817183358_backfill_legacy_document_storage_paths.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817192825_crypto_foundation_truthful_certification.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260817194126; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260817194126_crypto_foundation_truthful_certification.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260817201827_registration_workspace_slug_and_invite_identity.sql | sí | no | SUPERSEDED | Representada por 20260817202824; SQL normalizado equivalente. |
| 20260817202824_registration_workspace_slug_and_invite_identity.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260820120000_default_autografa_stamp_ac0.sql | sí | no | SUPERSEDED | Representada por 20260820231916; SQL normalizado equivalente. |
| 20260820130000_persist_signature_stamp_evidence.sql | sí | no | SUPERSEDED | Representada por 20260820234122; SQL normalizado equivalente. |
| 20260820231916_default_autografa_stamp_ac0.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260820234122_persist_signature_stamp_evidence.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821100000_wp_crypto_01_capability_statuses.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821222955; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821113000_wp_crypto_02_certification_orchestrator.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821222958; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821120000_wp_crypto_03_key_management_provider.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821223000; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821123000_wp_crypto_04_x509_certificate_layer.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821223003; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821200622_wp_crypto_05_pades_engine.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821223008; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821204141_wp_crypto_06_rfc3161_tsa.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821223010; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821210000_wp_crypto_07_security_hardening.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260821223031; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260821222955_wp_crypto_01_capability_statuses.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821222958_wp_crypto_02_certification_orchestrator.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821223000_wp_crypto_03_key_management_provider.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821223003_wp_crypto_04_x509_certificate_layer.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821223008_wp_crypto_05_pades_engine.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821223010_wp_crypto_06_rfc3161_tsa.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260821223031_wp_crypto_07_security_hardening.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260826215313_document_additional_metadata.sql | sí | no | UNKNOWN | Sin replay local ni equivalencia completa de definiciones no existe evidencia suficiente para repair. |
| 20260828153000_fix_legal_evidence_pgcrypto_resolution.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260828223717; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260828223717_fix_legal_evidence_pgcrypto_resolution.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829005923_external_tsa_provenance.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260829015344; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260829015344_external_tsa_provenance.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829023344_nom151_audit_alignment.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260829030432; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260829030432_nom151_audit_alignment.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829030526_consolidate_nom151_read_policy.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260829030600; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260829030600_consolidate_nom151_read_policy.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829030915_replace_nom151_document_uniqueness.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260829030942; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260829030942_replace_nom151_document_uniqueness.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829051444_nom151_production_trust.sql | sí | no | SUPERSEDED | Mismo nombre lógico que 20260829051752; requiere conservar la versión remota efectiva y no reejecutar a ciegas. |
| 20260829051752_nom151_production_trust.sql | no | sí | REMOTE_ONLY | Archivo recuperado del historial remoto; no pertenece al historial Git rastreado. |
| 20260829232609_document_encryption_metadata.sql | no | no | ACTUALLY_PENDING | No figura en historial remoto; tabla metadata remota es legacy/vacía y falta security_events. |

## Totales

- APPLIED_BUT_UNTRACKED: 0
- ACTUALLY_PENDING: 1
- SUPERSEDED: 25
- CONFLICTING: 0
- REMOTE_ONLY: 25
- UNKNOWN: 174
