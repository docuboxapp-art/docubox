import { notifyOrganizationSecurityEvent } from '@/lib/organization/security-alerts.server';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { organizationCatalogs } from '@/lib/organization/catalog';
import { parseOrganizationCatalogValues } from '@/lib/organization/catalog-validation';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';

export const runtime = 'nodejs';
const relationTables = {
  evidence: 'organization_directory_evidence',
  members: 'workspace_members',
  units: 'organization_units',
  people: 'organization_directory_people',
  certificates: 'organization_certificates',
  workflows: 'organization_approval_workflows',
  policies: 'organization_signature_policies',
};
function catalog(resource: string) {
  const config = organizationCatalogs[resource];
  if (!config)
    throw new OrganizationApiError(404, 'invalid_catalog', 'Este catálogo no está disponible.');
  return config;
}
function failure(cause: unknown) {
  if (cause instanceof z.ZodError)
    return Response.json(
      {
        success: false,
        code: 'validation_error',
        error: 'Revisa los datos del formulario.',
        details: cause.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 422 }
    );
  return organizationApiFailure(cause);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource') || '';
    const config = catalog(resource);
    const workspaceId = z.string().uuid().parse(url.searchParams.get('workspace_id'));
    const id = url.searchParams.get('id');
    if (id) z.string().uuid().parse(id);
    const { service, userClient } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      `${config.permission}.read`
    );
    const permission = await userClient.rpc('has_organization_permission', {
      ws_id: workspaceId,
      requested_permission: `${config.permission}.manage`,
    });
    if (permission.error)
      throw new OrganizationApiError(
        503,
        'permissions_unavailable',
        'No se pudieron comprobar los permisos.'
      );
    // Never return credentials, hidden identifiers or identity assertions in the editor.
    const columns = [
      'id',
      ...(['certificates', 'certificate_access'].includes(resource) ? [] : ['updated_at']),
      ...config.fields.map((field) => field.key),
      ...(resource === 'domains'
        ? ['domain', 'dns_status']
        : ['certificate_access', 'alerts'].includes(resource)
          ? []
          : ['status']),
    ];
    let query = service
      .from(config.table)
      .select(columns.join(','))
      .eq('workspace_id', workspaceId);
    if (id) query = query.eq('id', id);
    const records = await query.limit(500);
    if (records.error) throw records.error;
    if (id && !records.data?.length)
      throw new OrganizationApiError(
        404,
        'catalog_record_not_found',
        'No se encontró el registro en esta organización.'
      );
    const options: Record<string, Array<{ value: string; label: string }>> = {};
    if (permission.data === true) {
      const relations = [
        ...new Set(config.fields.flatMap((field) => (field.relation ? [field.relation] : []))),
      ];
      await Promise.all(
        relations.map(async (relation) => {
          const table = relationTables[relation];
          const names =
            relation === 'evidence'
              ? 'id,display_name'
              : relation === 'members'
                ? 'id,user_profiles(full_name,email)'
                : relation === 'people'
                  ? 'id,full_name'
                  : relation === 'certificates'
                    ? 'id,alias,subject_name'
                    : 'id,name';
          let lookup = service.from(table).select(names).eq('workspace_id', workspaceId);
          if (relation !== 'certificates')
            lookup = lookup.eq(
              'status',
              relation === 'evidence'
                ? 'verified'
                : ['workflows', 'policies'].includes(relation)
                  ? 'published'
                  : 'active'
            );
          const result = await lookup.limit(1000);
          if (result.error) throw result.error;
          options[relation] = ((result.data || []) as unknown as Record<string, unknown>[]).map(
            (row) => {
              const profile = Array.isArray(row.user_profiles)
                ? row.user_profiles[0]
                : row.user_profiles;
              const person = profile as { full_name?: string; email?: string } | undefined;
              return {
                value: String(row.id),
                label: String(
                  person?.full_name ||
                    person?.email ||
                    row.full_name ||
                    row.name ||
                    row.alias ||
                    row.display_name ||
                    row.subject_name ||
                    row.id
                ),
              };
            }
          );
        })
      );
    }
    return Response.json(
      {
        success: true,
        data: records.data || [],
        fields: config.fields,
        title: config.title,
        options,
        statuses: config.statuses || [],
        canManage: permission.data === true,
        sensitive: !!config.sensitive,
        canCreate: !!config.create,
        versioned: !!config.versioned,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return failure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const body = z
      .object({
        workspace_id: z.string().uuid(),
        resource: z.string(),
        id: z.string().uuid().nullable().optional(),
        action: z.enum(['save', 'status', 'remove']),
        values: z.record(z.string(), z.unknown()).optional(),
        status: z.string().optional(),
        expected_updated_at: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .strict()
      .parse(await request.json().catch(() => null));
    const config = catalog(body.resource);
    const { user, service } = await authorizeOrganizationRequest(
      request,
      body.workspace_id,
      `${config.permission}.manage`
    );
    if (config.sensitive)
      await requireOrganizationReauthentication(
        request,
        body.workspace_id,
        user.id,
        `${config.permission}.manage`
      );
    if (!body.id && !config.create)
      throw new OrganizationApiError(
        409,
        'catalog_creation_unavailable',
        'Crea este registro desde su flujo correspondiente.'
      );
    let existing: Record<string, unknown> | null = null;
    if (body.id) {
      const result = await service
        .from(config.table)
        .select('*')
        .eq('workspace_id', body.workspace_id)
        .eq('id', body.id)
        .maybeSingle();
      if (result.error) throw result.error;
      existing = result.data;
      if (!existing)
        throw new OrganizationApiError(
          404,
          'catalog_record_not_found',
          'No se encontró el registro en esta organización.'
        );
    }
    if (
      existing &&
      body.expected_updated_at &&
      Date.parse(String(existing.updated_at)) !== Date.parse(body.expected_updated_at)
    )
      throw new OrganizationApiError(
        409,
        'catalog_record_conflict',
        'Otra persona actualizó el registro. Cierra el editor y vuelve a abrirlo antes de guardar.'
      );
    if (
      body.resource === 'authorities' &&
      existing?.status === 'revoked' &&
      !(body.action === 'status' && body.status === 'revoked')
    )
      throw new OrganizationApiError(
        409,
        'authority_revoked',
        'Registra una nueva facultad para sustituir una revocada.'
      );
    if (body.action === 'remove') {
      if (body.resource !== 'certificate_access' || !body.id)
        throw new OrganizationApiError(
          409,
          'catalog_removal_unavailable',
          'Este registro se conserva mediante sus estados.'
        );
      const removed = await service.rpc('remove_organization_certificate_access', {
        ws_id: body.workspace_id,
        actor_user_id: user.id,
        permission_id: body.id,
      });
      if (removed.error) throw removed.error;
      await notifyOrganizationSecurityEvent(service, {
        event: 'certificate.changed',
        eventId: randomUUID(),
        workspaceId: body.workspace_id,
        actorUserId: user.id,
      });
      return Response.json({ success: true, ...removed.data });
    }
    let values: Record<string, unknown>;
    if (body.action === 'status') {
      if (!existing || !body.status || !config.statuses?.includes(body.status))
        throw new OrganizationApiError(422, 'invalid_status', 'Selecciona un estado permitido.');
      if (config.versioned && body.status === 'draft' && existing.status !== 'draft')
        throw new OrganizationApiError(
          409,
          'version_required',
          'Crea una nueva versión para editar el registro publicado.'
        );
      values = { status: body.status };
      if (body.resource === 'authorities' && body.status === 'active') {
        if (existing.status === 'revoked')
          throw new OrganizationApiError(
            409,
            'authority_revoked',
            'Registra una nueva facultad para sustituir una revocada.'
          );
        if (
          existing.valid_until &&
          String(existing.valid_until) < new Date().toISOString().slice(0, 10)
        )
          throw new OrganizationApiError(
            409,
            'authority_expired',
            'Actualiza la vigencia y vuelve a validar la facultad.'
          );
        const evidence = existing.evidence_id
          ? await service
              .from('organization_directory_evidence')
              .select('id,valid_from,valid_until')
              .eq('workspace_id', body.workspace_id)
              .eq('person_id', existing.person_id)
              .eq('id', existing.evidence_id)
              .eq('status', 'verified')
              .maybeSingle()
          : { data: null, error: null };
        if (evidence.error) throw evidence.error;
        if (
          !evidence.data ||
          (evidence.data.valid_until &&
            String(evidence.data.valid_until).slice(0, 10) <
              new Date().toISOString().slice(0, 10)) ||
          (evidence.data.valid_from &&
            String(evidence.data.valid_from).slice(0, 10) > new Date().toISOString().slice(0, 10))
        )
          throw new OrganizationApiError(
            409,
            'authority_evidence_required',
            'Vincula evidencia vigente y validada antes de activar la facultad.'
          );
        values.approved_by = user.id;
        values.approved_at = new Date().toISOString();
      }
      if (body.resource === 'authorities' && body.status === 'revoked') {
        values.revoked_by = user.id;
        values.revoked_at = new Date().toISOString();
      }
    } else {
      if (config.versioned && existing && existing.status !== 'draft')
        throw new OrganizationApiError(
          409,
          'version_required',
          'Crea una nueva versión para editar este registro.'
        );
      values = parseOrganizationCatalogValues(body.resource, body.values || {}, !body.id);
      if (!Object.keys(values).length)
        throw new OrganizationApiError(422, 'empty_changes', 'No hay cambios para guardar.');
      if (body.resource === 'resources' && 'configuration' in values)
        values.configuration = {
          ...((existing?.configuration || {}) as Record<string, unknown>),
          text: values.configuration || '',
        };
      const combined = { ...existing, ...values };
      if (body.resource === 'authorities') {
        if (combined.evidence_id) {
          const proof = await service
            .from('organization_directory_evidence')
            .select('id')
            .eq('workspace_id', body.workspace_id)
            .eq('person_id', combined.person_id)
            .eq('id', combined.evidence_id)
            .eq('status', 'verified')
            .maybeSingle();
          if (proof.error) throw proof.error;
          if (!proof.data)
            throw new OrganizationApiError(
              422,
              'authority_evidence_scope',
              'Selecciona evidencia validada de la misma persona.'
            );
        }
        if (
          existing?.status === 'active' &&
          Object.keys(values).some((key) => values[key] !== existing![key])
        ) {
          values.status = 'pending_validation';
          values.approved_by = null;
          values.approved_at = null;
        }
      }
      if (
        combined.valid_from &&
        combined.valid_until &&
        String(combined.valid_from) > String(combined.valid_until)
      )
        throw new OrganizationApiError(422, 'invalid_validity', 'Revisa el rango de vigencia.');
      if (
        body.resource === 'certificate_access' &&
        Boolean(combined.member_id) === Boolean(combined.unit_id)
      )
        throw new OrganizationApiError(
          422,
          'certificate_access_target',
          'Selecciona un miembro o un equipo.'
        );
      if (
        body.resource === 'domains' &&
        combined.sender_email &&
        String(combined.sender_email).split('@')[1]?.toLowerCase() !==
          String(existing?.domain).toLowerCase()
      )
        throw new OrganizationApiError(
          422,
          'sender_domain_mismatch',
          'El correo remitente debe pertenecer al dominio registrado.'
        );
      if (body.resource === 'networks') {
        const [address, prefix] = String(combined.network_cidr).split('/');
        const family = isIP(address);
        const bits = Number(prefix);
        if (
          !family ||
          prefix === undefined ||
          !/^\d+$/.test(prefix) ||
          bits < 0 ||
          bits > (family === 4 ? 32 : 128)
        )
          throw new OrganizationApiError(
            422,
            'invalid_cidr',
            'Escribe una red IPv4 o IPv6 con su prefijo CIDR.'
          );
      }
      if (
        body.resource === 'directory' &&
        existing &&
        ['full_name', 'email', 'member_id'].some(
          (key) => key in values && values[key] !== existing![key]
        )
      )
        values.identity_status = 'not_started';
      if (body.resource === 'templates') {
        if (
          typeof combined.template_key === 'string' &&
          !/^[a-z0-9._-]{2,100}$/.test(combined.template_key)
        )
          throw new OrganizationApiError(
            422,
            'invalid_template_key',
            'La clave solo admite minúsculas, números, puntos, guiones y guiones bajos.'
          );
        if (existing) values.legal_version = Number(existing.legal_version || 1) + 1;
      }
      if (!body.id && body.resource === 'authorities') values.status = 'pending_validation';
      if (!body.id && body.resource === 'policies') {
        values.requirements = { evidence: ['ip', 'user_agent', 'document_hash'] };
        values.status = 'draft';
      }
    }
    for (const field of config.fields.filter((field) => field.relation && values[field.key])) {
      const result = await service
        .from(relationTables[field.relation!])
        .select('id')
        .eq('workspace_id', body.workspace_id)
        .eq('id', values[field.key])
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        throw new OrganizationApiError(
          422,
          'catalog_relation_scope',
          'Selecciona registros de esta organización.'
        );
    }
    const result = await service.rpc('mutate_organization_catalog', {
      ws_id: body.workspace_id,
      actor_user_id: user.id,
      catalog_key: body.resource,
      record_id: body.id || null,
      patch: values,
      expected_updated_at: body.expected_updated_at || existing?.updated_at || null,
    });
    if (result.error) throw result.error;
    if (['certificates', 'certificate_access'].includes(body.resource))
      await notifyOrganizationSecurityEvent(service, {
        event: 'certificate.changed',
        eventId: randomUUID(),
        workspaceId: body.workspace_id,
        actorUserId: user.id,
      });
    return Response.json({ success: true, ...result.data }, { status: body.id ? 200 : 201 });
  } catch (cause) {
    return failure(cause);
  }
}
