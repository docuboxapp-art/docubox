-- ============================================================
-- CLEANUP: Eliminar todos los datos de usuarios registrados
-- para reiniciar pruebas. Ejecutar con precaución.
-- ============================================================

DO $$
DECLARE
    all_user_ids UUID[];
BEGIN
    -- Obtener todos los IDs de usuarios registrados
    SELECT ARRAY_AGG(id) INTO all_user_ids FROM auth.users;

    IF all_user_ids IS NULL OR array_length(all_user_ids, 1) = 0 THEN
        RAISE NOTICE 'No hay usuarios registrados para eliminar.';
        RETURN;
    END IF;

    RAISE NOTICE 'Eliminando datos de % usuario(s)...', array_length(all_user_ids, 1);

    -- Eliminar en orden de dependencias (hijos primero)
    DELETE FROM public.user_verification_status WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.face_comparison_logs WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.nubarium_ocr_logs WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.enrollment_results WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.enrollment_sessions WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.enrollment_tokens WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.serial_validations WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.curp_validations WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.subscription_history WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.subscriptions WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.workspace_documents
        WHERE workspace_id IN (
            SELECT workspace_id FROM public.workspace_members WHERE user_id = ANY(all_user_ids)
        );
    DELETE FROM public.workspace_members WHERE user_id = ANY(all_user_ids);
    DELETE FROM public.workspaces WHERE owner_id = ANY(all_user_ids);
    DELETE FROM public.user_profiles WHERE id = ANY(all_user_ids);

    -- Eliminar sesiones y tokens de auth
    DELETE FROM auth.sessions WHERE user_id = ANY(all_user_ids);
    DELETE FROM auth.refresh_tokens WHERE user_id = ANY(all_user_ids);
    DELETE FROM auth.mfa_amr_claims
        WHERE session_id IN (
            SELECT id FROM auth.sessions WHERE user_id = ANY(all_user_ids)
        );
    DELETE FROM auth.identities WHERE user_id = ANY(all_user_ids);

    -- Finalmente eliminar los usuarios de auth
    DELETE FROM auth.users WHERE id = ANY(all_user_ids);

    RAISE NOTICE 'Limpieza completada. Todos los usuarios y datos relacionados han sido eliminados.';

EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'Error de clave foranea durante la limpieza: %', SQLERRM;
    WHEN OTHERS THEN
        RAISE NOTICE 'Error durante la limpieza: %', SQLERRM;
END $$;
