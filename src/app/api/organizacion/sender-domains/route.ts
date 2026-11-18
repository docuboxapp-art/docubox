import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { Resend } from 'resend';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
} from '@/lib/organization/server';

export const runtime = 'nodejs';
type Verification = { provider_id?: string; challenge?: string };
function reference(value: unknown): Verification {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function problem(cause: unknown) {
  if (cause instanceof z.ZodError)
    return Response.json(
      { success: false, error: 'Selecciona un dominio válido.' },
      { status: 422 }
    );
  return organizationApiFailure(cause);
}

export async function POST(request: Request) {
  try {
    const body = z
      .object({
        workspace_id: z.string().uuid(),
        domain_id: z.string().uuid(),
        action: z.enum(['prepare', 'verify']),
      })
      .strict()
      .parse(await request.json().catch(() => null));
    const { user, service } = await authorizeOrganizationRequest(
      request,
      body.workspace_id,
      'branding.manage'
    );
    const record = await service
      .from('organization_sender_domains')
      .select('id,domain,dns_status,verification_reference')
      .eq('workspace_id', body.workspace_id)
      .eq('id', body.domain_id)
      .maybeSingle();
    if (record.error) throw record.error;
    if (!record.data)
      throw new OrganizationApiError(
        404,
        'domain_not_found',
        'No se encontró el dominio en esta organización.'
      );
    const ref = reference(record.data.verification_reference);
    ref.challenge ||= randomBytes(24).toString('hex');
    const challenge = {
      type: 'TXT',
      name: `_docubox.${record.data.domain}`,
      value: `docubox-verification=${ref.challenge}`,
    };
    const key = process.env.RESEND_API_KEY;
    let provider: {
      status: string;
      records: Array<{ type: string; name: string; value: string; priority?: number }>;
    } | null = null;
    if (key) {
      const resend = new Resend(key);
      if (!ref.provider_id && body.action === 'prepare') {
        const domains = await resend.domains.list();
        if (domains.error)
          throw new OrganizationApiError(
            503,
            'domain_provider_unavailable',
            'No se pudo consultar el proveedor de correo.'
          );
        ref.provider_id = domains.data.data.find(
          (domain) => domain.name.toLowerCase() === record.data!.domain.toLowerCase()
        )?.id;
        if (!ref.provider_id) {
          const created = await resend.domains.create({ name: record.data.domain });
          if (created.error)
            throw new OrganizationApiError(
              503,
              'domain_provider_unavailable',
              'No se pudo registrar el dominio con el proveedor de correo.'
            );
          ref.provider_id = created.data.id;
        }
      }
      if (ref.provider_id) {
        if (body.action === 'verify') {
          const requested = await resend.domains.verify(ref.provider_id);
          if (requested.error)
            throw new OrganizationApiError(
              503,
              'domain_provider_unavailable',
              'No se pudo solicitar la verificación del proveedor.'
            );
        }
        const result = await resend.domains.get(ref.provider_id);
        if (result.error)
          throw new OrganizationApiError(
            503,
            'domain_provider_unavailable',
            'No se pudo consultar la verificación del proveedor.'
          );
        provider = result.data;
      }
    }
    let ownership = false;
    if (body.action === 'verify') {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const rows = await Promise.race([
          resolveTxt(challenge.name),
          new Promise<string[][]>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('dns_timeout')), 8000);
          }),
        ]);
        ownership = rows.some((parts) => parts.join('') === challenge.value);
      } catch {
        ownership = false;
      } finally {
        clearTimeout(timer);
      }
    }
    // Provider verification alone cannot establish ownership for another tenant.
    const verified = ownership && provider?.status === 'verified';
    const saved = await service.rpc('mutate_organization_catalog', {
      ws_id: body.workspace_id,
      actor_user_id: user.id,
      catalog_key: 'domains',
      record_id: body.domain_id,
      patch: {
        verification_reference: JSON.stringify(ref),
        last_checked_at: new Date().toISOString(),
        ...(body.action === 'verify' ? { dns_status: verified ? 'verified' : 'pending' } : {}),
      },
      expected_updated_at: null,
    });
    if (saved.error) throw saved.error;
    return Response.json(
      {
        success: true,
        status: verified ? 'verified' : 'pending',
        ownership_verified: ownership,
        provider_configured: !!key,
        records: [
          challenge,
          ...(provider?.records || []).map((row) => ({
            type: row.type,
            name: row.name,
            value: row.value,
            priority: row.priority,
          })),
        ],
        message: verified
          ? 'El dominio y el proveedor de correo están verificados.'
          : !key
            ? 'Configura el proveedor de correo y agrega el registro de propiedad antes de verificar.'
            : 'Agrega estos registros en tu proveedor DNS y vuelve a comprobar la verificación.',
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (cause) {
    return problem(cause);
  }
}
