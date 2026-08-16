import { createHash, createCipheriv, randomBytes } from 'crypto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';

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

  const userClient = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
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
  if (permissionError || allowed !== true) {
    throw new OrganizationApiError(
      403,
      'permission_denied',
      'No tienes permiso para realizar esta acción.'
    );
  }

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

  const verifier = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
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

  if (error || !data || !Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) {
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
  const master =
    process.env.ORGANIZATION_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  const error = cause as Partial<OrganizationApiError>;
  const databaseMessage = typeof error.message === 'string' ? error.message : '';
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
