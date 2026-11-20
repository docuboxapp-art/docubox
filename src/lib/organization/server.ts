import { createHash, createCipheriv, randomBytes } from 'crypto';
import { ZodError } from 'zod';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import { isDefinitivelyInvalidAuthToken } from '@/lib/supabase/auth-verification';
import { getUserForRequest } from '@/lib/supabase/user-request.server';

export class OrganizationApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function authenticateOrganizationRequest(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token)
    throw new OrganizationApiError(401, 'authentication_required', 'Inicia sesión para continuar.');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new OrganizationApiError(
      503,
      'supabase_not_configured',
      'El servicio no está configurado.'
    );

  const userClient = createAnonClient(token);
  const { data: authData, error: authError } = await getUserForRequest(
    userClient,
    token,
    `${url}\0${anonKey}`
  ).catch(() => ({
    data: { user: null },
    error: { status: 503 },
  }));
  if (authError && !isDefinitivelyInvalidAuthToken(authError))
    throw new OrganizationApiError(
      503,
      'authentication_unavailable',
      'No se pudo verificar la sesión. Intenta nuevamente.'
    );
  if (authError || !authData.user)
    throw new OrganizationApiError(
      401,
      'invalid_session',
      'La sesión expiró. Vuelve a iniciar sesión.'
    );

  return { user: authData.user, userClient, service: createServiceClient() };
}

export async function authorizeOrganizationRequest(
  request: Request,
  workspaceId: string,
  permission: string
) {
  if (!workspaceId)
    throw new OrganizationApiError(400, 'workspace_required', 'Selecciona una organización.');
  const authenticated = await authenticateOrganizationRequest(request);

  const { data: allowed, error: permissionError } = await authenticated.userClient.rpc(
    'has_organization_permission',
    {
      ws_id: workspaceId,
      requested_permission: permission,
    }
  );
  if (permissionError)
    throw new OrganizationApiError(
      503,
      'permissions_unavailable',
      'No se pudieron comprobar los permisos. Intenta nuevamente.'
    );
  if (allowed !== true) {
    throw new OrganizationApiError(
      403,
      'permission_denied',
      'No tienes permiso para realizar esta acción.'
    );
  }

  const workspace = await authenticated.service
    .from('workspaces')
    .select('id,workspace_type')
    .eq('id', workspaceId)
    .maybeSingle();
  if (workspace.error)
    throw new OrganizationApiError(
      503,
      'organization_unavailable',
      'No se pudo consultar la organización.'
    );
  if (workspace.data?.workspace_type !== 'business')
    throw new OrganizationApiError(
      403,
      'organization_required',
      'Selecciona un espacio de organización.'
    );

  return authenticated;
}

export async function verifyOrganizationPassword(
  userId: string,
  email: string | undefined,
  password: string
) {
  if (!email || !password)
    throw new OrganizationApiError(
      401,
      'reauthentication_required',
      'Confirma tu contraseña para continuar.'
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new OrganizationApiError(
      503,
      'supabase_not_configured',
      'El servicio no está configurado.'
    );

  const verifier = createAnonClient();
  const { data, error } = await verifier.auth
    .signInWithPassword({ email, password })
    .catch(() => ({ data: { user: null }, error: { status: 503 } }));
  if (
    error &&
    (!('status' in error) || !error.status || error.status >= 500 || error.status === 429)
  )
    throw new OrganizationApiError(
      503,
      'reauthentication_unavailable',
      'No se pudo confirmar la identidad. Intenta nuevamente.'
    );
  if (error || data.user?.id !== userId) {
    throw new OrganizationApiError(
      401,
      'reauthentication_failed',
      'La contraseña no pudo confirmarse.'
    );
  }
}

export async function requireOrganizationReauthentication(
  request: Request,
  workspaceId: string,
  userId: string,
  requiredScope: string
) {
  const token = request.headers.get('x-organization-reauth')?.trim() || '';
  if (!token) {
    throw new OrganizationApiError(
      401,
      'reauthentication_required',
      'Confirma tu identidad para continuar.'
    );
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const service = createServiceClient();
  const { data, error } = await service
    .from('organization_reauthentication_sessions')
    .select('id,expires_at,scopes,revoked_at')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error)
    throw new OrganizationApiError(
      503,
      'reauthentication_unavailable',
      'No se pudo comprobar la confirmación de identidad.'
    );
  if (!data || !Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) {
    throw new OrganizationApiError(
      401,
      'reauthentication_invalid',
      'La confirmacion de identidad vencio o no autoriza esta accion.'
    );
  }

  return data;
}

export function createOpaqueSecret(prefix: string) {
  const publicPart = randomBytes(6).toString('hex');
  const secretPart = randomBytes(32).toString('base64url');
  const value = `${prefix}_${publicPart}.${secretPart}`;
  return {
    value,
    publicPrefix: `${prefix}_${publicPart}`,
    hash: createHash('sha256').update(value).digest('hex'),
  };
}

export function encryptOrganizationSecret(value: string) {
  const master = process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY;
  if (!master)
    throw new OrganizationApiError(
      503,
      'secret_store_not_configured',
      'La custodia de secretos no está configurada.'
    );
  const key = createHash('sha256').update(`docubox:organization-secrets:v1:${master}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    version: 1,
  };
}

export function organizationApiFailure(cause: unknown) {
  if (cause instanceof ZodError)
    return Response.json(
      { success: false, code: 'validation_error', error: 'Revisa los datos del formulario.' },
      { status: 422 }
    );
  const error = cause as Partial<OrganizationApiError>;
  const databaseMessage = typeof error.message === 'string' ? error.message : '';
  if (
    ['42883', 'PGRST202', '42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code || '') &&
    /finalize_organization_directory_evidence|organization_directory_upload_available/.test(
      databaseMessage
    )
  )
    return Response.json(
      {
        success: false,
        code: 'organization_update_required',
        error:
          'Hay una actualización de Organización pendiente de aplicar. Contacta al administrador.',
      },
      { status: 503 }
    );
  if (
    ['42883', 'PGRST202', '42P01', 'PGRST205', 'PGRST204', '42703'].includes(error.code || '') &&
    /colabora_|collaboration_request_(?:items|form_links)|collaboration_document_requests/.test(
      databaseMessage
    )
  )
    return Response.json(
      {
        success: false,
        code: 'collaboration_update_required',
        error:
          'Hay una actualización de Colabora pendiente de aplicar en la base de datos. Contacta al administrador.',
      },
      { status: 503 }
    );
  const knownDatabaseErrors: Record<string, [number, string]> = {
    organization_mutation_scope_denied: [
      403,
      'La acción o asignación está fuera del alcance de tu rol.',
    ],
    organization_offboarding_permission_revoked: [
      403,
      'El solicitante de la baja ya no tiene permiso para ejecutarla.',
    ],
    task_version_conflict: [409, 'La tarea cambió en otra sesión. Recarga antes de modificarla.'],
    task_closed: [409, 'Reabre la tarea antes de modificarla.'],
    task_transition_invalid: [409, 'El estado actual de la tarea no permite esta acción.'],
    task_reason_required: [422, 'Indica el motivo de la acción.'],
    task_mutation_invalid: [422, 'Revisa los cambios seleccionados para las tareas.'],
    task_not_due: [409, 'La tarea todavía no alcanza su fecha de inicio.'],
    task_completion_pending: [
      409,
      'Completa el checklist y las dependencias antes de cerrar la tarea.',
    ],
    task_source_action_required: [
      409,
      'Completa la acción en el recurso vinculado para actualizar esta tarea.',
    ],
    task_result_required: [422, 'Describe el resultado realizado con entre 15 y 1,000 caracteres.'],
    organization_scope_invalid: [
      422,
      'Revisa el alcance y selecciona unidades activas de esta organización.',
    ],
    request_form_receipt_exists: [
      409,
      'Este requisito ya tiene una respuesta recibida. Recarga para consultarla.',
    ],
    request_otp_rate_limited: [429, 'Espera un minuto antes de solicitar otro código.'],
    review_closed: [409, 'La ronda de revisión ya está cerrada.'],
    review_already_open: [409, 'Esta versión ya tiene una ronda de revisión abierta.'],
    review_version_mismatch: [422, 'Selecciona una versión editable del documento.'],
    review_blocking_comments: [409, 'Resuelve los comentarios bloqueantes antes de aprobar.'],
    request_required_items_pending: [409, 'Hay requisitos obligatorios pendientes de revisión.'],
    request_reason_required: [422, 'Indica un motivo accionable.'],
    form_response_required: [409, 'El formulario todavía no tiene una respuesta recibida.'],
    form_signature_pending: [409, 'La firma del formulario sigue pendiente.'],
    signature_pending: [409, 'El documento todavía no ha completado su firma.'],
    request_file_required: [409, 'El requisito todavía no tiene un archivo recibido.'],
    request_file_security_scan_required: [
      409,
      'El archivo debe superar el análisis de seguridad antes de aprobarse.',
    ],
    request_locked: [409, 'La solicitud está cerrada o en revisión.'],
    request_item_locked: [409, 'El requisito ya no admite cambios.'],
    request_item_has_evidence: [
      409,
      'El requisito ya tiene entregas o accesos emitidos y debe conservarse.',
    ],
    request_item_required: [409, 'La solicitud debe conservar al menos un requisito.'],
    request_item_limit: [409, 'La solicitud admite un máximo de 50 requisitos.'],
    request_form_revision_changed: [
      409,
      'El formulario cambió de versión. Actualiza el requisito antes de continuar.',
    ],
    request_invitation_rate_limited: [429, 'Espera un minuto antes de reenviar la invitación.'],
    request_session_invalid: [
      401,
      'La sesión de la solicitud venció. Vuelve a verificar tu correo.',
    ],
    catalog_record_not_found: [404, 'No se encontró el registro en esta organización.'],
    catalog_record_conflict: [409, 'Otra persona actualizó el registro. Recarga antes de guardar.'],
    catalog_relation_scope: [422, 'Selecciona registros de esta organización.'],
    catalog_version_required: [409, 'Crea una nueva versión para modificar un registro publicado.'],
    catalog_fields_invalid: [422, 'Revisa los campos que quieres guardar.'],
    organization_permission_denied: [403, 'No tienes permiso para realizar esta acción.'],
    organization_workspace_required: [422, 'Selecciona una organización.'],
    organization_unit_not_found: [404, 'No se encontró un equipo activo.'],
    organization_role_not_found: [404, 'No se encontró el rol.'],
    organization_unit_parent_invalid: [422, 'Selecciona un equipo superior de esta organización.'],
    organization_unit_hierarchy_cycle: [
      422,
      'El equipo superior no puede depender de este mismo equipo.',
    ],
    organization_unit_lead_membership_required: [
      422,
      'Antes de retirar al responsable o suplente, cambia su asignación en Equipos y áreas.',
    ],
    organization_unit_member_scope_invalid: [
      422,
      'Selecciona miembros activos de esta organización.',
    ],
    organization_cost_center_scope_invalid: [
      422,
      'Selecciona un centro de costo de esta organización.',
    ],
    organization_permission_selection_invalid: [422, 'Selecciona permisos válidos del catálogo.'],
    system_role_is_read_only: [
      409,
      'Los roles base y archivados están protegidos. Crea un nuevo rol para personalizarlos.',
    ],
  };
  const knownKey = Object.keys(knownDatabaseErrors).find((key) => databaseMessage.includes(key));
  if (knownKey) {
    const [status, message] = knownDatabaseErrors[knownKey];
    return Response.json({ success: false, code: knownKey, error: message }, { status });
  }
  if (error.code === '23505')
    return Response.json(
      { success: false, code: 'record_exists', error: 'Ya existe un registro con esos datos.' },
      { status: 409 }
    );
  if (error.code === '23514' || error.code === '23503')
    return Response.json(
      {
        success: false,
        code: 'invalid_record',
        error: 'Revisa los datos y las relaciones del registro.',
      },
      { status: 422 }
    );
  if (databaseMessage.includes('collaboration_usage_limit_exceeded')) {
    return Response.json(
      {
        success: false,
        code: 'collaboration_usage_limit_exceeded',
        error: 'Alcanzaste el limite de uso incluido en tu plan de Colabora.',
      },
      { status: 409 }
    );
  }
  const status = typeof error.status === 'number' ? error.status : 500;
  const code = error.code || 'internal_error';
  const message =
    status >= 500 ? 'No se pudo completar la operación.' : error.message || 'Solicitud inválida.';
  return Response.json({ success: false, code, error: message }, { status });
}
