-- LucIA Phase 3: authorized, minimal, read-only context RPCs (remote version 20260905070112).
-- These functions centralize authorization inside PostgreSQL. They never write
-- domain data and are callable only with an authenticated Supabase session.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.lucia_workspace_role(p_workspace_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT lower(wm.role::text)
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = auth.uid()
    AND wm.status = 'active'
    AND (wm.access_expires_at IS NULL OR wm.access_expires_at > now())
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.lucia_context_error(
  p_module TEXT,
  p_workspace_id UUID,
  p_resource_id UUID,
  p_role TEXT,
  p_error_code TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'module', p_module,
    'resource_id', p_resource_id,
    'workspace_id', p_workspace_id,
    'permission', jsonb_build_object(
      'can_view', false,
      'role', p_role,
      'reason', p_reason
    ),
    'summary', '{}'::jsonb,
    'items', '[]'::jsonb,
    'counts', '{}'::jsonb,
    'statuses', '{}'::jsonb,
    'pending_actions', '[]'::jsonb,
    'evidence_sources', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'error_code', p_error_code,
    'row_count', 0
  )
$$;

REVOKE ALL ON FUNCTION private.lucia_workspace_role(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.lucia_context_error(TEXT, UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_lucia_organization_context(
  p_workspace_id UUID,
  p_section TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_can_read_members BOOLEAN := false;
  v_can_read_directory BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, NULL,
      'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, NULL,
      'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  v_can_read_members := v_role IN ('owner', 'admin', 'workspace_admin')
    OR public.has_organization_permission(p_workspace_id, 'members.read');
  v_can_read_directory := v_role IN ('owner', 'admin', 'workspace_admin')
    OR public.has_organization_permission(p_workspace_id, 'directory.read');

  IF p_resource_id IS NOT NULL AND lower(COALESCE(p_section, '')) LIKE '%directorio%' THEN
    IF NOT v_can_read_directory THEN
      RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, v_role,
        'RESOURCE_ACCESS_DENIED', 'directory_read_permission_required');
    END IF;
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb), count(*)::INTEGER
    INTO v_items, v_row_count
    FROM (
      SELECT jsonb_build_object(
        'id', odp.id,
        'person_type', odp.person_type,
        'relationship_type', odp.relationship_type,
        'status', odp.status,
        'identity_status', odp.identity_status,
        'valid_from', odp.valid_from,
        'valid_until', odp.valid_until
      ) AS item
      FROM public.organization_directory_people odp
      WHERE odp.workspace_id = p_workspace_id AND odp.id = p_resource_id
    ) visible_directory;
    IF v_row_count = 0 THEN
      RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, v_role,
        'RESOURCE_NOT_FOUND', 'directory_resource_not_found');
    END IF;
  ELSIF p_resource_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb), count(*)::INTEGER
    INTO v_items, v_row_count
    FROM (
      SELECT jsonb_build_object('id', wm.id, 'role', wm.role::text, 'status', wm.status,
        'joined_at', wm.joined_at, 'access_expires_at', wm.access_expires_at) AS item
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.id = p_resource_id
        AND (v_can_read_members OR wm.user_id = v_user_id)
    ) visible_member;
    IF v_row_count = 0 THEN
      RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, v_role,
        'RESOURCE_NOT_FOUND_OR_DENIED', 'member_not_visible');
    END IF;
  ELSE
    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb), count(*)::INTEGER
    INTO v_items, v_row_count
    FROM (
      SELECT jsonb_build_object('id', wm.id, 'role', wm.role::text, 'status', wm.status,
        'joined_at', wm.joined_at, 'access_expires_at', wm.access_expires_at) AS item
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND (v_can_read_members OR wm.user_id = v_user_id)
      ORDER BY wm.joined_at DESC NULLS LAST
      LIMIT 25
    ) visible_members;
  END IF;

  SELECT jsonb_build_object(
    'members', count(*),
    'active_members', count(*) FILTER (WHERE wm.status = 'active'),
    'roles', (SELECT count(*) FROM public.organization_roles r
      WHERE r.workspace_id = p_workspace_id AND r.status = 'active'),
    'units', (SELECT count(*) FROM public.organization_units u
      WHERE u.workspace_id = p_workspace_id AND u.status = 'active')
  ) INTO v_counts
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND (v_can_read_members OR wm.user_id = v_user_id);

  SELECT COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_statuses
  FROM (
    SELECT wm.status, count(*) AS amount
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND (v_can_read_members OR wm.user_id = v_user_id)
    GROUP BY wm.status
  ) grouped_statuses;

  v_sources := jsonb_build_array(
    jsonb_build_object('source', 'workspace_members', 'source_id', p_workspace_id::text),
    jsonb_build_object('source', 'organization_roles', 'source_id', p_workspace_id::text),
    jsonb_build_object('source', 'organization_units', 'source_id', p_workspace_id::text)
  );

  RETURN jsonb_build_object(
    'module', 'organization', 'resource_id', p_resource_id, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', CASE WHEN v_can_read_members THEN 'authorized_member_reader' ELSE 'self_membership_only' END),
    'summary', jsonb_build_object('section', COALESCE(p_section, 'overview')),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', '[]'::jsonb, 'error_code', NULL, 'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('organization', p_workspace_id, p_resource_id, v_role,
    'SCHEMA_UNAVAILABLE', 'organization_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_collaboration_context(
  p_workspace_id UUID,
  p_section TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_entitled BOOLEAN := false;
  v_can_view BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
  v_resource_visible BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, NULL,
      'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;
  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, NULL,
      'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;
  v_entitled := public.has_collaboration_entitlement(p_workspace_id, 'collaboration_core', false);
  v_can_view := public.has_organization_permission(p_workspace_id, 'collaboration_spaces.view');
  IF NOT v_entitled THEN
    RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, v_role,
      'ENTITLEMENT_REQUIRED', 'collaboration_core_entitlement_required');
  END IF;
  IF NOT v_can_view THEN
    RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, v_role,
      'RESOURCE_ACCESS_DENIED', 'collaboration_spaces_view_permission_required');
  END IF;

  IF p_resource_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.collaboration_spaces cs
      WHERE cs.workspace_id = p_workspace_id AND cs.id = p_resource_id
        AND (v_role IN ('owner','admin','workspace_admin') OR cs.owner_id = v_user_id
          OR cs.created_by = v_user_id OR EXISTS (
            SELECT 1 FROM public.collaboration_space_members csm
            WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cs.id
              AND csm.user_id = v_user_id AND csm.status = 'active'))
      UNION ALL
      SELECT 1 FROM public.collaboration_document_requests cdr
      WHERE cdr.workspace_id = p_workspace_id AND cdr.id = p_resource_id
        AND (v_role IN ('owner','admin','workspace_admin') OR cdr.created_by = v_user_id
          OR cdr.responsible_user_id = v_user_id OR EXISTS (
            SELECT 1 FROM public.collaboration_space_members csm
            WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cdr.space_id
              AND csm.user_id = v_user_id AND csm.status = 'active'))
    ) INTO v_resource_visible;
    IF NOT v_resource_visible THEN
      RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, v_role,
        'RESOURCE_NOT_FOUND_OR_DENIED', 'collaboration_resource_not_visible');
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb), count(*)::INTEGER
  INTO v_items, v_row_count
  FROM (
    SELECT jsonb_build_object('id', cs.id, 'kind', 'collaboration_space',
      'name', cs.name, 'space_type', cs.space_type,
      'status', cs.status, 'confidentiality', cs.confidentiality,
      'case_file_id', cs.case_file_id, 'updated_at', cs.updated_at) AS item
    FROM public.collaboration_spaces cs
    WHERE cs.workspace_id = p_workspace_id
      AND (p_resource_id IS NULL OR cs.id = p_resource_id)
      AND (v_role IN ('owner','admin','workspace_admin') OR cs.owner_id = v_user_id
        OR cs.created_by = v_user_id OR EXISTS (
          SELECT 1 FROM public.collaboration_space_members csm
          WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cs.id
            AND csm.user_id = v_user_id AND csm.status = 'active'))
    UNION ALL
    SELECT jsonb_build_object('id', cdr.id, 'kind', 'document_request',
      'folio', cdr.folio, 'title', cdr.title, 'status', cdr.status,
      'space_id', cdr.space_id, 'case_file_id', cdr.case_file_id,
      'due_at', cdr.due_at, 'updated_at', cdr.updated_at) AS item
    FROM public.collaboration_document_requests cdr
    WHERE cdr.workspace_id = p_workspace_id
      AND (p_resource_id IS NULL OR cdr.id = p_resource_id)
      AND (v_role IN ('owner','admin','workspace_admin') OR cdr.created_by = v_user_id
        OR cdr.responsible_user_id = v_user_id OR EXISTS (
          SELECT 1 FROM public.collaboration_space_members csm
          WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cdr.space_id
            AND csm.user_id = v_user_id AND csm.status = 'active'))
    LIMIT 25
  ) visible_resources;

  SELECT jsonb_build_object(
    'spaces', count(*),
    'active_spaces', count(*) FILTER (WHERE cs.status = 'active'),
    'pending_requests', (SELECT count(*) FROM public.collaboration_document_requests cdr
      WHERE cdr.workspace_id = p_workspace_id AND cdr.status IN ('draft','sent','in_progress','in_review')
        AND (v_role IN ('owner','admin','workspace_admin') OR cdr.created_by = v_user_id
          OR cdr.responsible_user_id = v_user_id OR EXISTS (
            SELECT 1 FROM public.collaboration_space_members csm
            WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cdr.space_id
              AND csm.user_id = v_user_id AND csm.status = 'active'))),
    'open_reviews', (SELECT count(*) FROM public.collaboration_review_rounds crr
      WHERE crr.workspace_id = p_workspace_id AND crr.status NOT IN ('approved','rejected','closed')
        AND (v_role IN ('owner','admin','workspace_admin') OR crr.requested_by = v_user_id
          OR EXISTS (SELECT 1 FROM public.collaboration_reviewers cr
            WHERE cr.review_round_id = crr.id AND cr.user_id = v_user_id)))
  ) INTO v_counts
  FROM public.collaboration_spaces cs
  WHERE cs.workspace_id = p_workspace_id
    AND (v_role IN ('owner','admin','workspace_admin') OR cs.owner_id = v_user_id
      OR cs.created_by = v_user_id OR EXISTS (
        SELECT 1 FROM public.collaboration_space_members csm
        WHERE csm.workspace_id = p_workspace_id AND csm.space_id = cs.id
          AND csm.user_id = v_user_id AND csm.status = 'active'));

  SELECT COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_statuses
  FROM (
    SELECT cs.status, count(*) amount FROM public.collaboration_spaces cs
    WHERE cs.workspace_id = p_workspace_id
      AND (v_role IN ('owner','admin','workspace_admin') OR cs.owner_id = v_user_id
        OR cs.created_by = v_user_id OR EXISTS (
          SELECT 1 FROM public.collaboration_space_members csm
          WHERE csm.space_id = cs.id AND csm.user_id = v_user_id AND csm.status = 'active'))
    GROUP BY cs.status
  ) grouped_statuses;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source',
    CASE item->>'kind' WHEN 'document_request' THEN 'collaboration_document_requests'
      ELSE 'collaboration_spaces' END,
    'source_id', item->>'id')), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'collaboration', 'resource_id', p_resource_id, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'entitlement_and_resource_acl_verified'),
    'summary', jsonb_build_object('section', COALESCE(p_section, 'overview')),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_SPACES') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('collaboration', p_workspace_id, p_resource_id, v_role,
    'SCHEMA_UNAVAILABLE', 'collaboration_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_case_file_context(
  p_workspace_id UUID,
  p_case_file_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_pending JSONB := '[]'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('expedientes', p_workspace_id, p_case_file_id, NULL,
      'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;
  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('expedientes', p_workspace_id, p_case_file_id, NULL,
      'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;
  v_manager := v_role IN ('owner','admin','workspace_admin');

  IF p_case_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.case_files cf
    WHERE cf.workspace_id = p_workspace_id AND cf.id = p_case_file_id
      AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
        SELECT 1 FROM public.case_file_participants cfp
        WHERE cfp.workspace_id = p_workspace_id AND cfp.case_file_id = cf.id
          AND cfp.user_id = v_user_id AND cfp.status = 'active'))
  ) THEN
    RETURN private.lucia_context_error('expedientes', p_workspace_id, p_case_file_id, v_role,
      'RESOURCE_NOT_FOUND_OR_DENIED', 'case_file_not_visible');
  END IF;

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb), count(*)::INTEGER
  INTO v_items, v_row_count
  FROM (
    SELECT jsonb_build_object('id', cf.id, 'folio', cf.folio, 'title', cf.title,
      'case_type', cf.case_type, 'status', cf.status, 'priority', cf.priority,
      'progress', cf.progress, 'target_close_at', cf.target_close_at,
      'closure_status', cf.closure_status, 'updated_at', cf.updated_at) AS item
    FROM public.case_files cf
    WHERE cf.workspace_id = p_workspace_id
      AND (p_case_file_id IS NULL OR cf.id = p_case_file_id)
      AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
        SELECT 1 FROM public.case_file_participants cfp
        WHERE cfp.workspace_id = p_workspace_id AND cfp.case_file_id = cf.id
          AND cfp.user_id = v_user_id AND cfp.status = 'active'))
    ORDER BY cf.updated_at DESC
    LIMIT 25
  ) visible_cases;

  SELECT jsonb_build_object(
    'case_files', count(*),
    'required_items', (SELECT count(*) FROM public.case_file_requirements cfr
      WHERE cfr.workspace_id = p_workspace_id AND cfr.is_required
        AND (p_case_file_id IS NULL OR cfr.case_file_id = p_case_file_id)
        AND EXISTS (SELECT 1 FROM public.case_files cf WHERE cf.id = cfr.case_file_id
          AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
            SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
              AND cfp.user_id = v_user_id AND cfp.status = 'active')))),
    'documents', (SELECT count(*) FROM public.case_file_documents cfd
      WHERE cfd.workspace_id = p_workspace_id
        AND (p_case_file_id IS NULL OR cfd.case_file_id = p_case_file_id)
        AND (cfd.source_document_id IS NULL OR public.can_access_documento(cfd.source_document_id))
        AND EXISTS (SELECT 1 FROM public.case_files cf WHERE cf.id = cfd.case_file_id
          AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
            SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
              AND cfp.user_id = v_user_id AND cfp.status = 'active'))))
  ) INTO v_counts
  FROM public.case_files cf
  WHERE cf.workspace_id = p_workspace_id
    AND (p_case_file_id IS NULL OR cf.id = p_case_file_id)
    AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
      SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
        AND cfp.user_id = v_user_id AND cfp.status = 'active'));

  SELECT COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_statuses
  FROM (
    SELECT cf.status, count(*) amount FROM public.case_files cf
    WHERE cf.workspace_id = p_workspace_id
      AND (p_case_file_id IS NULL OR cf.id = p_case_file_id)
      AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
        SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
          AND cfp.user_id = v_user_id AND cfp.status = 'active'))
    GROUP BY cf.status
  ) grouped_statuses;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', cfr.id, 'title', cfr.title,
    'status', cfr.status, 'category', cfr.category)), '[]'::jsonb)
  INTO v_pending
  FROM public.case_file_requirements cfr
  WHERE cfr.workspace_id = p_workspace_id
    AND (p_case_file_id IS NULL OR cfr.case_file_id = p_case_file_id)
    AND cfr.is_required AND cfr.status NOT IN ('completed','approved','waived')
    AND EXISTS (SELECT 1 FROM public.case_files cf WHERE cf.id = cfr.case_file_id
      AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
        SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
          AND cfp.user_id = v_user_id AND cfp.status = 'active')))
  LIMIT 25;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', 'case_files',
    'source_id', cf.id::text)), '[]'::jsonb)
  INTO v_sources
  FROM public.case_files cf
  WHERE cf.workspace_id = p_workspace_id
    AND (p_case_file_id IS NULL OR cf.id = p_case_file_id)
    AND (v_manager OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id OR EXISTS (
      SELECT 1 FROM public.case_file_participants cfp WHERE cfp.case_file_id = cf.id
        AND cfp.user_id = v_user_id AND cfp.status = 'active'))
  LIMIT 25;

  RETURN jsonb_build_object(
    'module', 'expedientes', 'resource_id', p_case_file_id, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'case_file_acl_verified'),
    'summary', jsonb_build_object('selected', p_case_file_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', v_pending, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_CASE_FILES') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('expedientes', p_workspace_id, p_case_file_id, v_role,
    'SCHEMA_UNAVAILABLE', 'case_file_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_certification_context(
  p_workspace_id UUID,
  p_certification_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_can_list BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('certifications', p_workspace_id, p_certification_id,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('certifications', p_workspace_id, p_certification_id,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  v_manager := v_role IN ('owner', 'admin');
  v_can_list := v_manager OR public.has_organization_permission(p_workspace_id, 'certifications.view');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', visible.id,
    'kind', visible.kind,
    'status', visible.status,
    'service_key', visible.service_key,
    'source_document_id', visible.source_document_id,
    'created_at', visible.created_at,
    'completed_at', visible.completed_at
  ) ORDER BY visible.created_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM (
    SELECT cc.id, 'certification_case'::text AS kind, cc.status,
      cc.service_key, cc.source_document_id, cc.created_at,
      COALESCE(cc.validated_at, cc.issued_at) AS completed_at
    FROM public.certification_cases cc
    WHERE cc.workspace_id = p_workspace_id
      AND (p_certification_id IS NULL OR cc.id = p_certification_id)
      AND (v_can_list OR cc.created_by = v_user_id OR cc.assigned_reviewer_id = v_user_id
        OR (cc.source_document_id IS NOT NULL AND public.can_access_documento(cc.source_document_id)))
    UNION ALL
    SELECT dc.id, 'document_certification'::text, dc.status,
      COALESCE(dc.certification_type, 'document')::text, dc.document_id,
      dc.created_at, dc.completed_at
    FROM public.document_certifications dc
    WHERE dc.workspace_id = p_workspace_id
      AND (p_certification_id IS NULL OR dc.id = p_certification_id)
      AND public.can_access_documento(dc.document_id)
    ORDER BY created_at DESC
    LIMIT 25
  ) visible;

  IF p_certification_id IS NOT NULL AND v_row_count = 0 THEN
    RETURN private.lucia_context_error('certifications', p_workspace_id, p_certification_id,
      v_role, 'RESOURCE_NOT_FOUND_OR_DENIED', 'certification_not_visible');
  END IF;

  SELECT jsonb_build_object(
    'certification_cases', count(*) FILTER (WHERE kind = 'certification_case'),
    'document_certifications', count(*) FILTER (WHERE kind = 'document_certification')
  ), COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_counts, v_statuses
  FROM (
    SELECT item->>'kind' AS kind, item->>'status' AS status, count(*) AS amount
    FROM jsonb_array_elements(v_items) item
    GROUP BY item->>'kind', item->>'status'
  ) grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', item->>'kind', 'source_id', item->>'id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'certifications', 'resource_id', p_certification_id,
    'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'certification_acl_verified'),
    'summary', jsonb_build_object('selected', p_certification_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_CERTIFICATIONS') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('certifications', p_workspace_id, p_certification_id,
    v_role, 'SCHEMA_UNAVAILABLE', 'certification_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_certified_notification_context(
  p_workspace_id UUID,
  p_notification_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('certified_notifications', p_workspace_id, p_notification_id,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('certified_notifications', p_workspace_id, p_notification_id,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  IF to_regclass('public.certified_notifications') IS NULL
    OR to_regclass('public.notification_recipients') IS NULL THEN
    RETURN private.lucia_context_error('certified_notifications', p_workspace_id, p_notification_id,
      v_role, 'SCHEMA_UNAVAILABLE', 'certified_notification_schema_missing');
  END IF;

  v_manager := v_role IN ('owner', 'admin');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cn.id, 'folio', cn.folio, 'subject', cn.subject,
    'status', cn.status, 'evidence_level', cn.evidence_level,
    'response_mode', cn.response_mode, 'source_document_id', cn.source_document_id,
    'recipient_count', (SELECT count(*) FROM public.notification_recipients nr
      WHERE nr.notification_id = cn.id
        AND (v_manager OR cn.created_by = v_user_id OR public.can_access_documento(cn.source_document_id)
          OR nr.user_id = v_user_id)),
    'pending_recipients', (SELECT count(*) FROM public.notification_recipients nr
      WHERE nr.notification_id = cn.id AND nr.status IN ('pending','notified')
        AND (v_manager OR cn.created_by = v_user_id OR public.can_access_documento(cn.source_document_id)
          OR nr.user_id = v_user_id)),
    'due_at', cn.due_at, 'created_at', cn.created_at, 'completed_at', cn.completed_at
  ) ORDER BY cn.created_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM (
    SELECT source.* FROM public.certified_notifications source
    WHERE source.workspace_id = p_workspace_id
      AND (p_notification_id IS NULL OR source.id = p_notification_id)
      AND (v_manager OR source.created_by = v_user_id
        OR public.can_access_documento(source.source_document_id)
        OR EXISTS (SELECT 1 FROM public.notification_recipients nr
          WHERE nr.notification_id = source.id AND nr.user_id = v_user_id))
    ORDER BY source.created_at DESC LIMIT 25
  ) cn;

  IF p_notification_id IS NOT NULL AND v_row_count = 0 THEN
    RETURN private.lucia_context_error('certified_notifications', p_workspace_id, p_notification_id,
      v_role, 'RESOURCE_NOT_FOUND_OR_DENIED', 'certified_notification_not_visible');
  END IF;

  SELECT jsonb_build_object('notifications', v_row_count,
      'recipients', COALESCE(sum((item->>'recipient_count')::integer), 0),
      'pending_recipients', COALESCE(sum((item->>'pending_recipients')::integer), 0)),
    COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_counts, v_statuses
  FROM (
    SELECT item, item->>'status' AS status, count(*) OVER (PARTITION BY item->>'status') AS amount
    FROM jsonb_array_elements(v_items) item
  ) grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'certified_notifications', 'source_id', item->>'id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'certified_notifications', 'resource_id', p_notification_id,
    'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'certified_notification_acl_verified'),
    'summary', jsonb_build_object('selected', p_notification_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_CERTIFIED_NOTIFICATIONS') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('certified_notifications', p_workspace_id, p_notification_id,
    v_role, 'SCHEMA_UNAVAILABLE', 'certified_notification_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_batch_signature_context(
  p_workspace_id UUID,
  p_batch_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('batch_signatures', p_workspace_id, p_batch_id,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('batch_signatures', p_workspace_id, p_batch_id,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  IF to_regclass('public.bulk_signature_campaigns') IS NULL
    OR to_regclass('public.bulk_campaign_items') IS NULL THEN
    RETURN private.lucia_context_error('batch_signatures', p_workspace_id, p_batch_id,
      v_role, 'SCHEMA_UNAVAILABLE', 'batch_signature_schema_missing');
  END IF;

  v_manager := v_role IN ('owner', 'admin');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', bc.id, 'name', bc.name, 'campaign_type', bc.campaign_type,
    'status', bc.status, 'priority', bc.priority,
    'total_items', bc.total_items, 'completed_items', bc.completed_items,
    'pending_items', bc.pending_items, 'failed_items', bc.failed_items,
    'participant_count', bc.participant_count,
    'scheduled_at', bc.scheduled_at, 'expires_at', bc.expires_at,
    'created_at', bc.created_at, 'completed_at', bc.completed_at
  ) ORDER BY bc.updated_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM (
    SELECT source.* FROM public.bulk_signature_campaigns source
    WHERE source.workspace_id = p_workspace_id
      AND (p_batch_id IS NULL OR source.id = p_batch_id)
      AND (v_manager OR source.owner_user_id = v_user_id OR source.created_by = v_user_id)
    ORDER BY source.updated_at DESC LIMIT 25
  ) bc;

  IF p_batch_id IS NOT NULL AND v_row_count = 0 THEN
    RETURN private.lucia_context_error('batch_signatures', p_workspace_id, p_batch_id,
      v_role, 'RESOURCE_NOT_FOUND_OR_DENIED', 'batch_not_visible');
  END IF;

  SELECT jsonb_build_object(
      'batches', v_row_count,
      'total_items', COALESCE(sum((item->>'total_items')::integer), 0),
      'completed_items', COALESCE(sum((item->>'completed_items')::integer), 0),
      'pending_items', COALESCE(sum((item->>'pending_items')::integer), 0),
      'failed_items', COALESCE(sum((item->>'failed_items')::integer), 0)),
    COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_counts, v_statuses
  FROM (
    SELECT item, item->>'status' AS status, count(*) OVER (PARTITION BY item->>'status') AS amount
    FROM jsonb_array_elements(v_items) item
  ) grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'bulk_signature_campaigns', 'source_id', item->>'id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'batch_signatures', 'resource_id', p_batch_id,
    'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'batch_signature_acl_verified'),
    'summary', jsonb_build_object('selected', p_batch_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_BATCHES') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('batch_signatures', p_workspace_id, p_batch_id,
    v_role, 'SCHEMA_UNAVAILABLE', 'batch_signature_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_credit_title_context(
  p_workspace_id UUID,
  p_credit_title_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('credit_titles', p_workspace_id, p_credit_title_id,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('credit_titles', p_workspace_id, p_credit_title_id,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  IF to_regclass('public.credit_titles') IS NULL THEN
    RETURN private.lucia_context_error('credit_titles', p_workspace_id, p_credit_title_id,
      v_role, 'SCHEMA_UNAVAILABLE', 'credit_title_schema_missing');
  END IF;

  v_manager := v_role IN ('owner', 'admin');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ct.id, 'folio', ct.folio, 'title_type', ct.title_type,
    'status', ct.status, 'nominal_amount', ct.nominal_amount,
    'outstanding_balance', ct.outstanding_balance, 'currency', ct.currency,
    'maturity_date', ct.maturity_date,
    'source_document_id', ct.source_document_id,
    'representation_document_id', ct.representation_document_id,
    'issued_at', ct.issued_at, 'created_at', ct.created_at
  ) ORDER BY ct.updated_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM (
    SELECT source.* FROM public.credit_titles source
    WHERE source.workspace_id = p_workspace_id
      AND (p_credit_title_id IS NULL OR source.id = p_credit_title_id)
      AND (v_manager OR source.created_by = v_user_id
        OR (source.source_document_id IS NOT NULL AND public.can_access_documento(source.source_document_id))
        OR (source.representation_document_id IS NOT NULL
          AND public.can_access_documento(source.representation_document_id)))
    ORDER BY source.updated_at DESC LIMIT 25
  ) ct;

  IF p_credit_title_id IS NOT NULL AND v_row_count = 0 THEN
    RETURN private.lucia_context_error('credit_titles', p_workspace_id, p_credit_title_id,
      v_role, 'RESOURCE_NOT_FOUND_OR_DENIED', 'credit_title_not_visible');
  END IF;

  SELECT jsonb_build_object(
      'titles', v_row_count,
      'nominal_amount', COALESCE(sum((item->>'nominal_amount')::numeric), 0),
      'outstanding_balance', COALESCE(sum((item->>'outstanding_balance')::numeric), 0)),
    COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_counts, v_statuses
  FROM (
    SELECT item, item->>'status' AS status, count(*) OVER (PARTITION BY item->>'status') AS amount
    FROM jsonb_array_elements(v_items) item
  ) grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'credit_titles', 'source_id', item->>'id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'credit_titles', 'resource_id', p_credit_title_id,
    'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'credit_title_acl_verified'),
    'summary', jsonb_build_object('selected', p_credit_title_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_CREDIT_TITLES') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('credit_titles', p_workspace_id, p_credit_title_id,
    v_role, 'SCHEMA_UNAVAILABLE', 'credit_title_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_form_context(
  p_workspace_id UUID,
  p_form_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('forms', p_workspace_id, p_form_id,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('forms', p_workspace_id, p_form_id,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  v_manager := v_role IN ('owner', 'admin');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ft.id, 'name', ft.name, 'status', ft.status,
    'document_id', ft.document_id,
    'requires_signature', COALESCE(ft.requires_signature, false),
    'field_count', CASE
      WHEN jsonb_typeof(COALESCE(ft.form_schema, ft.schema, '[]'::jsonb)) = 'array'
        THEN jsonb_array_length(COALESCE(ft.form_schema, ft.schema, '[]'::jsonb))
      ELSE 0 END,
    'response_count', (SELECT count(*) FROM public.form_responses fr WHERE fr.template_id = ft.id),
    'submitted_count', (SELECT count(*) FROM public.form_responses fr
      WHERE fr.template_id = ft.id AND COALESCE(fr.status, 'submitted') = 'submitted'),
    'created_at', ft.created_at, 'updated_at', ft.updated_at
  ) ORDER BY ft.updated_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM (
    SELECT source.* FROM public.form_templates source
    WHERE source.workspace_id = p_workspace_id
      AND (p_form_id IS NULL OR source.id = p_form_id)
      AND (v_manager OR source.created_by = v_user_id
        OR (source.document_id IS NOT NULL AND public.can_access_documento(source.document_id)))
    ORDER BY source.updated_at DESC LIMIT 25
  ) ft;

  IF p_form_id IS NOT NULL AND v_row_count = 0 THEN
    RETURN private.lucia_context_error('forms', p_workspace_id, p_form_id,
      v_role, 'RESOURCE_NOT_FOUND_OR_DENIED', 'form_not_visible');
  END IF;

  SELECT jsonb_build_object(
      'forms', v_row_count,
      'responses', COALESCE(sum((item->>'response_count')::integer), 0),
      'submitted', COALESCE(sum((item->>'submitted_count')::integer), 0)),
    COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_counts, v_statuses
  FROM (
    SELECT item, item->>'status' AS status, count(*) OVER (PARTITION BY item->>'status') AS amount
    FROM jsonb_array_elements(v_items) item
  ) grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'form_templates', 'source_id', item->>'id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'forms', 'resource_id', p_form_id, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', 'form_acl_verified'),
    'summary', jsonb_build_object('selected', p_form_id IS NOT NULL),
    'items', v_items, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_VISIBLE_FORMS') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('forms', p_workspace_id, p_form_id,
    v_role, 'SCHEMA_UNAVAILABLE', 'form_schema_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_report_context(
  p_workspace_id UUID,
  p_report_scope TEXT DEFAULT 'personal',
  p_filters JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_scope TEXT := CASE WHEN lower(COALESCE(p_report_scope, 'personal')) = 'workspace'
    THEN 'workspace' ELSE 'personal' END;
  v_manager BOOLEAN := false;
  v_can_workspace_report BOOLEAN := false;
  v_counts JSONB := '{}'::jsonb;
  v_statuses JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('reports', p_workspace_id, NULL,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('reports', p_workspace_id, NULL,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  v_manager := v_role IN ('owner', 'admin');
  v_can_workspace_report := v_manager OR public.has_organization_permission(p_workspace_id, 'reports.view');
  IF v_scope = 'workspace' AND NOT v_can_workspace_report THEN
    RETURN private.lucia_context_error('reports', p_workspace_id, NULL,
      v_role, 'RESOURCE_ACCESS_DENIED', 'workspace_report_permission_required');
  END IF;

  SELECT jsonb_build_object(
    'documents', (SELECT count(*) FROM public.documentos d
      WHERE d.workspace_id = p_workspace_id
        AND public.can_access_documento(d.id)
        AND (v_scope = 'workspace' OR d.owner_id = v_user_id)
        AND (p_filters->>'status' IS NULL OR d.estado = p_filters->>'status')),
    'tasks', (SELECT count(*) FROM public.tareas t
      WHERE t.workspace_id = p_workspace_id
        AND (v_scope = 'workspace' OR t.assigned_to = v_user_id OR t.created_by = v_user_id)
        AND (p_filters->>'status' IS NULL OR t.estado::text = p_filters->>'status')),
    'case_files', (SELECT count(*) FROM public.case_files cf
      WHERE cf.workspace_id = p_workspace_id
        AND (v_scope = 'workspace' OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id
          OR EXISTS (SELECT 1 FROM public.case_file_participants cfp
            WHERE cfp.case_file_id = cf.id AND cfp.user_id = v_user_id AND cfp.status = 'active'))
        AND (p_filters->>'status' IS NULL OR cf.status = p_filters->>'status'))
  ) INTO v_counts;

  SELECT COALESCE(jsonb_object_agg(status, amount), '{}'::jsonb)
  INTO v_statuses
  FROM (
    SELECT d.estado AS status, count(*) AS amount
    FROM public.documentos d
    WHERE d.workspace_id = p_workspace_id AND public.can_access_documento(d.id)
      AND (v_scope = 'workspace' OR d.owner_id = v_user_id)
    GROUP BY d.estado
  ) document_statuses;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', source_name, 'source_id', id::text)), '[]'::jsonb)
  INTO v_sources
  FROM (
    SELECT 'documentos'::text AS source_name, d.id FROM public.documentos d
    WHERE d.workspace_id = p_workspace_id AND public.can_access_documento(d.id)
      AND (v_scope = 'workspace' OR d.owner_id = v_user_id)
    UNION ALL
    SELECT 'tareas', t.id FROM public.tareas t
    WHERE t.workspace_id = p_workspace_id
      AND (v_scope = 'workspace' OR t.assigned_to = v_user_id OR t.created_by = v_user_id)
    UNION ALL
    SELECT 'case_files', cf.id FROM public.case_files cf
    WHERE cf.workspace_id = p_workspace_id
      AND (v_scope = 'workspace' OR cf.owner_user_id = v_user_id OR cf.created_by = v_user_id
        OR EXISTS (SELECT 1 FROM public.case_file_participants cfp
          WHERE cfp.case_file_id = cf.id AND cfp.user_id = v_user_id AND cfp.status = 'active'))
    LIMIT 25
  ) visible_sources;

  v_row_count := COALESCE((v_counts->>'documents')::integer, 0)
    + COALESCE((v_counts->>'tasks')::integer, 0)
    + COALESCE((v_counts->>'case_files')::integer, 0);

  RETURN jsonb_build_object(
    'module', 'reports', 'resource_id', NULL, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', CASE WHEN v_scope = 'workspace' THEN 'workspace_report_permission_verified'
        ELSE 'personal_report_scope' END),
    'summary', jsonb_build_object('scope', v_scope, 'filters_applied',
      jsonb_strip_nulls(jsonb_build_object('status', left(p_filters->>'status', 80)))),
    'items', '[]'::jsonb, 'counts', v_counts, 'statuses', v_statuses,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_REPORT_DATA') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column OR invalid_text_representation THEN
  RETURN private.lucia_context_error('reports', p_workspace_id, NULL,
    v_role, 'SCHEMA_UNAVAILABLE', 'report_schema_or_filter_unavailable');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_lucia_billing_context(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_manager BOOLEAN := false;
  v_can_read_billing BOOLEAN := false;
  v_items JSONB := '[]'::jsonb;
  v_counts JSONB := '{}'::jsonb;
  v_sources JSONB := '[]'::jsonb;
  v_row_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN private.lucia_context_error('billing', p_workspace_id, NULL,
      NULL, 'AUTHENTICATION_REQUIRED', 'authenticated_session_required');
  END IF;

  v_role := private.lucia_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RETURN private.lucia_context_error('billing', p_workspace_id, NULL,
      NULL, 'WORKSPACE_ACCESS_DENIED', 'active_workspace_membership_required');
  END IF;

  v_manager := v_role IN ('owner', 'admin');
  v_can_read_billing := v_manager OR public.has_organization_permission(p_workspace_id, 'billing.read');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subscription_id', s.id, 'status', s.status::text,
    'plan_id', sp.id, 'plan_name', sp.name, 'plan_slug', sp.slug,
    'interval', sp.interval::text, 'documents_used', s.documents_used,
    'documents_limit', s.documents_limit,
    'current_period_start', s.current_period_start,
    'current_period_end', s.current_period_end
  ) ORDER BY s.updated_at DESC), '[]'::jsonb), count(*)
  INTO v_items, v_row_count
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.workspace_id = p_workspace_id
    AND (v_can_read_billing OR s.user_id = v_user_id);

  SELECT jsonb_build_object(
    'subscriptions', v_row_count,
    'usage', CASE WHEN v_can_read_billing THEN COALESCE((
      SELECT jsonb_object_agg(metric_key, quantity)
      FROM (
        SELECT oul.metric_key, sum(oul.quantity) AS quantity
        FROM public.organization_usage_ledger oul
        WHERE oul.workspace_id = p_workspace_id
          AND oul.occurred_at >= date_trunc('month', now())
        GROUP BY oul.metric_key
      ) usage_by_metric
    ), '{}'::jsonb) ELSE '{}'::jsonb END
  ) INTO v_counts;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source', 'subscriptions', 'source_id', item->>'subscription_id'
  )), '[]'::jsonb)
  INTO v_sources
  FROM jsonb_array_elements(v_items) item;

  RETURN jsonb_build_object(
    'module', 'billing', 'resource_id', NULL, 'workspace_id', p_workspace_id,
    'permission', jsonb_build_object('can_view', true, 'role', v_role,
      'reason', CASE WHEN v_can_read_billing THEN 'billing_permission_verified'
        ELSE 'own_subscription_only' END),
    'summary', jsonb_build_object('usage_scope', CASE WHEN v_can_read_billing THEN 'workspace' ELSE 'own' END),
    'items', v_items, 'counts', v_counts, 'statuses', '{}'::jsonb,
    'pending_actions', '[]'::jsonb, 'evidence_sources', v_sources,
    'warnings', CASE WHEN v_row_count = 0 THEN jsonb_build_array('NO_ACTIVE_SUBSCRIPTION_DATA') ELSE '[]'::jsonb END,
    'error_code', CASE WHEN v_row_count = 0 THEN 'NO_DATA' ELSE NULL END,
    'row_count', v_row_count
  );
EXCEPTION WHEN undefined_table OR undefined_column THEN
  RETURN private.lucia_context_error('billing', p_workspace_id, NULL,
    v_role, 'SCHEMA_UNAVAILABLE', 'billing_schema_unavailable');
END;
$$;

-- SECURITY DEFINER is used because each RPC aggregates across tables with
-- different RLS models. Authorization is repeated inside every function and
-- no caller can execute the private helpers directly.
REVOKE ALL ON FUNCTION public.get_lucia_organization_context(UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_collaboration_context(UUID, TEXT, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_case_file_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_certification_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_certified_notification_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_batch_signature_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_credit_title_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_form_context(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_report_context(UUID, TEXT, JSONB) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_lucia_billing_context(UUID) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_lucia_organization_context(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_collaboration_context(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_case_file_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_certification_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_certified_notification_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_batch_signature_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_credit_title_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_form_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_report_context(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lucia_billing_context(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_lucia_organization_context(UUID, TEXT, UUID)
  IS 'Authorized minimal organization context for LucIA; read-only and PII-minimized.';
COMMENT ON FUNCTION public.get_lucia_collaboration_context(UUID, TEXT, UUID)
  IS 'Authorized minimal collaboration context for LucIA; read-only.';
COMMENT ON FUNCTION public.get_lucia_case_file_context(UUID, UUID)
  IS 'Authorized minimal case-file context for LucIA; read-only.';
COMMENT ON FUNCTION public.get_lucia_certification_context(UUID, UUID)
  IS 'Authorized minimal certification context for LucIA; excludes keys, hashes and storage paths.';
COMMENT ON FUNCTION public.get_lucia_certified_notification_context(UUID, UUID)
  IS 'Authorized minimal certified-notification context for LucIA; excludes contacts, tokens and evidence payloads.';
COMMENT ON FUNCTION public.get_lucia_batch_signature_context(UUID, UUID)
  IS 'Authorized minimal batch-signature context for LucIA; excludes source rows and identity policies.';
COMMENT ON FUNCTION public.get_lucia_credit_title_context(UUID, UUID)
  IS 'Authorized minimal credit-title context for LucIA; excludes parties, public tokens and canonical data.';
COMMENT ON FUNCTION public.get_lucia_form_context(UUID, UUID)
  IS 'Authorized minimal form context for LucIA; excludes answers, tokens and respondent identity.';
COMMENT ON FUNCTION public.get_lucia_report_context(UUID, TEXT, JSONB)
  IS 'Authorized aggregate-only report context for LucIA.';
COMMENT ON FUNCTION public.get_lucia_billing_context(UUID)
  IS 'Authorized minimal billing and usage context for LucIA; excludes payment data.';
