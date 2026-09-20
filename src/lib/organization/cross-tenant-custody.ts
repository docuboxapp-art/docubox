import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { OrganizationApiError, organizationApiFailure } from '@/lib/organization/server';

export const CROSS_TENANT_CUSTODY_TERMINAL_STATES = [
  'completado',
  'vencido',
  'cancelado',
  'rechazado',
] as const;

const custodyErrors: Record<string, { status: number; code: string; message: string }> = {
  CUSTODY_DOCUMENT_NOT_FOUND: {
    status: 404,
    code: 'document_not_found',
    message: 'Documento no encontrado.',
  },
  CUSTODY_TRANSFER_NOT_FOUND: {
    status: 404,
    code: 'transfer_not_found',
    message: 'Solicitud de custodia no encontrada.',
  },
  CUSTODY_SOURCE_SCOPE_DENIED: {
    status: 403,
    code: 'source_scope_denied',
    message: 'La organización ya no tiene la custodia vigente del documento.',
  },
  CUSTODY_SOURCE_PERMISSION_DENIED: {
    status: 403,
    code: 'source_permission_denied',
    message: 'No tienes permiso para transferir esta custodia.',
  },
  CUSTODY_SOURCE_NOT_ELIGIBLE: {
    status: 400,
    code: 'source_not_eligible',
    message: 'La custodia entre tenants requiere una organización de origen.',
  },
  CUSTODY_DESTINATION_PERMISSION_DENIED: {
    status: 403,
    code: 'destination_permission_denied',
    message: 'No tienes permiso para responder esta solicitud.',
  },
  CUSTODY_CANCEL_PERMISSION_DENIED: {
    status: 403,
    code: 'cancel_permission_denied',
    message: 'No tienes permiso para cancelar esta solicitud.',
  },
  CUSTODY_ACTIVE_DOCUMENT_DENIED: {
    status: 409,
    code: 'active_document_not_supported',
    message: 'La custodia entre organizaciones solo está disponible para documentos terminales.',
  },
  CUSTODY_ACTIVE_TRANSFER_EXISTS: {
    status: 409,
    code: 'active_transfer_exists',
    message: 'Ya existe una solicitud de custodia pendiente para este documento.',
  },
  CUSTODY_IDEMPOTENCY_CONFLICT: {
    status: 409,
    code: 'idempotency_conflict',
    message: 'La clave de idempotencia ya fue utilizada para otra solicitud.',
  },
  CUSTODY_TRANSFER_NOT_PENDING: {
    status: 409,
    code: 'transfer_not_pending',
    message: 'La solicitud ya fue resuelta.',
  },
  CUSTODY_CURRENT_SCOPE_CHANGED: {
    status: 409,
    code: 'custody_scope_changed',
    message: 'La custodia vigente cambió desde que se creó la solicitud.',
  },
  CUSTODY_DESTINATION_NOT_ELIGIBLE: {
    status: 400,
    code: 'destination_not_eligible',
    message: 'La organización destino no está disponible para recibir custodia.',
  },
  CUSTODY_USE_INTERNAL_TRANSFER: {
    status: 400,
    code: 'use_internal_transfer',
    message: 'Usa la transferencia interna para miembros de la misma organización.',
  },
  CUSTODY_EXPIRATION_INVALID: {
    status: 400,
    code: 'expiration_invalid',
    message: 'La vigencia de la solicitud no es válida.',
  },
  CUSTODY_ACTION_INVALID: {
    status: 400,
    code: 'action_invalid',
    message: 'Acción de custodia no válida.',
  },
};

export function mapCrossTenantCustodyError(cause: unknown): never {
  const message = cause instanceof Error ? cause.message : String(cause || '');
  const match = Object.entries(custodyErrors).find(([marker]) => message.includes(marker));
  if (match) {
    const [, mapped] = match;
    throw new OrganizationApiError(mapped.status, mapped.code, mapped.message);
  }
  throw cause;
}

export function crossTenantCustodyApiFailure(cause: unknown) {
  try {
    mapCrossTenantCustodyError(cause);
  } catch (mapped) {
    return organizationApiFailure(mapped);
  }
}

export async function resolveDestinationOrganization(service: SupabaseClient, identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  const result = await service
    .from('workspaces')
    .select('id,name,workspace_slug,workspace_type,organization_enabled')
    .eq('workspace_slug', normalized)
    .eq('workspace_type', 'business')
    .eq('organization_enabled', true)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}
