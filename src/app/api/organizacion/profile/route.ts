import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import {
  authorizeOrganizationRequest,
  OrganizationApiError,
  organizationApiFailure,
  requireOrganizationReauthentication,
} from '@/lib/organization/server';

export const runtime = 'nodejs';

const workspaceIdSchema = z.string().uuid();
const nullableText = (maximum: number) =>
  z.union([z.literal(''), z.string().trim().max(maximum)]).optional();
const generalSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    legal_name: nullableText(240),
    trade_name: nullableText(240),
    rfc: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/),
      ])
      .optional(),
    legal_person_type: z.enum(['individual_business', 'legal_entity']).or(z.literal('')).optional(),
    tax_regime: nullableText(160),
    industry: nullableText(160),
    website: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .refine((value) => ['https:', 'http:'].includes(new URL(value).protocol)),
      ])
      .optional(),
    contact_email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).optional(),
    contact_phone: nullableText(40),
    timezone: z.string().trim().min(3).max(80),
    locale: z
      .string()
      .trim()
      .regex(/^[a-z]{2}-[A-Z]{2}$/),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
  })
  .strict();
const addressSchema = z
  .object({
    postal_code: nullableText(10),
    state: nullableText(120),
    municipality: nullableText(160),
    locality: nullableText(160),
    neighborhood: nullableText(160),
    street: nullableText(200),
    exterior_number: nullableText(40),
    interior_number: nullableText(40),
    country: nullableText(2),
  })
  .strict();
const representativeSchema = z
  .object({
    full_name: nullableText(240),
    job_title: nullableText(160),
    rfc: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/),
      ])
      .optional(),
    curp: z
      .union([
        z.literal(''),
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/),
      ])
      .optional(),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email()]).optional(),
    phone: nullableText(40),
    valid_from: nullableText(10),
    valid_until: nullableText(10),
    instrument_reference: nullableText(240),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.valid_from && value.valid_until && value.valid_until < value.valid_from) {
      context.addIssue({
        code: 'custom',
        path: ['valid_until'],
        message: 'La vigencia final debe ser posterior al inicio.',
      });
    }
  });

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const extensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === 'string' ? item.trim() || null : item,
    ])
  );
}

function hasExpectedSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp')
    return (
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    );
  return false;
}

async function writeAudit(service: any, request: Request, values: Record<string, unknown>) {
  const inserted = await service.from('organization_audit_events').insert({
    ...values,
    correlation_id: randomUUID(),
    origin: 'api',
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent'),
  });
  if (inserted.error) throw inserted.error;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = workspaceIdSchema.parse(url.searchParams.get('workspace_id'));
    const evidenceId = url.searchParams.get('evidence_id');
    const permission = evidenceId ? 'kyb.download' : 'kyb.read';
    const { user, service } = await authorizeOrganizationRequest(request, workspaceId, permission);

    if (evidenceId) {
      const evidence = await service
        .from('organization_kyb_evidence')
        .select('id,storage_path,display_name')
        .eq('workspace_id', workspaceId)
        .eq('id', z.string().uuid().parse(evidenceId))
        .single();
      if (evidence.error || !evidence.data)
        throw new OrganizationApiError(
          404,
          'kyb_evidence_not_found',
          'La evidencia no está disponible.'
        );
      const signed = await service.storage
        .from('organization-kyb')
        .createSignedUrl(evidence.data.storage_path, 60, { download: evidence.data.display_name });
      if (signed.error || !signed.data?.signedUrl)
        throw signed.error || new Error('signed_url_failed');
      await writeAudit(service, request, {
        workspace_id: workspaceId,
        actor_user_id: user.id,
        event_type: 'kyb.evidence.downloaded',
        resource_type: 'organization_kyb_evidence',
        resource_id: evidence.data.id,
        summary: 'Evidencia KYB consultada mediante URL temporal',
        payload: {},
        outcome: 'success',
        severity: 'high',
        module: 'kyb',
      });
      return Response.json(
        { success: true, url: signed.data.signedUrl, expires_in: 60 },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const [evidence, history] = await Promise.all([
      service
        .from('organization_kyb_evidence')
        .select(
          'id,document_type,display_name,mime_type,byte_size,sha256,status,version,replaces_id,valid_until,rejection_reason,created_at,reviewed_at'
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false }),
      service
        .from('organization_verification_history')
        .select('id,status,provider,result_code,observations,next_review_at,occurred_at')
        .eq('workspace_id', workspaceId)
        .order('occurred_at', { ascending: false })
        .limit(100),
    ]);
    if (evidence.error) throw evidence.error;
    if (history.error) throw history.error;
    return Response.json(
      { success: true, evidence: evidence.data || [], history: history.data || [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const workspaceId = workspaceIdSchema.parse(body.workspace_id);
    const action = String(body.action || '');
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'organization.profile.update'
    );
    const current = await service
      .from('workspaces')
      .select(
        'name,legal_name,trade_name,rfc,legal_person_type,tax_regime,industry,website,contact_email,contact_phone,timezone,locale,currency,fiscal_address,legal_representative'
      )
      .eq('id', workspaceId)
      .single();
    if (current.error || !current.data)
      throw (
        current.error ||
        new OrganizationApiError(404, 'organization_not_found', 'La organización no existe.')
      );

    let updates: Record<string, unknown>;
    let eventType: string;
    let summary: string;
    let beforePayload: Record<string, unknown>;
    if (action === 'save_general') {
      const values = compact(generalSchema.parse(body.values || {}));
      const sensitive = ['legal_name', 'rfc', 'legal_person_type'].some(
        (key) => values[key] !== (current.data as any)[key]
      );
      if (sensitive)
        await requireOrganizationReauthentication(
          request,
          workspaceId,
          user.id,
          'organization.profile.update'
        );
      updates = values;
      eventType = 'organization.profile.updated';
      summary = 'Perfil general de la organización actualizado';
      beforePayload = Object.fromEntries(
        Object.keys(values).map((key) => [key, (current.data as any)[key]])
      );
    } else if (action === 'save_address') {
      const values = compact(addressSchema.parse(body.values || {}));
      updates = { fiscal_address: values };
      eventType = 'organization.fiscal_address.updated';
      summary = 'Domicilio fiscal actualizado';
      beforePayload = { fiscal_address: current.data.fiscal_address };
    } else if (action === 'save_representative') {
      const values = compact(representativeSchema.parse(body.values || {}));
      await requireOrganizationReauthentication(
        request,
        workspaceId,
        user.id,
        'organization.profile.update'
      );
      updates = { legal_representative: values };
      eventType = 'organization.legal_representative.updated';
      summary = 'Representación legal actualizada';
      beforePayload = { legal_representative: current.data.legal_representative };
    } else {
      throw new OrganizationApiError(
        400,
        'unsupported_profile_action',
        'La operación solicitada no está disponible.'
      );
    }

    const updated = await service
      .from('workspaces')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', workspaceId)
      .select('id')
      .single();
    if (updated.error) throw updated.error;
    await writeAudit(service, request, {
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: eventType,
      resource_type: 'workspace',
      resource_id: workspaceId,
      summary,
      payload: {},
      before_payload: beforePayload,
      after_payload: updates,
      outcome: 'success',
      severity: 'high',
      module: 'organization',
    });
    return Response.json({ success: true });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}

export async function PUT(request: Request) {
  try {
    const form = await request.formData();
    const workspaceId = workspaceIdSchema.parse(form.get('workspace_id'));
    const documentType = z
      .enum([
        'tax_status',
        'articles_of_incorporation',
        'notarial_power',
        'representative_id',
        'proof_of_address',
        'beneficial_owner',
        'other',
      ])
      .parse(form.get('document_type'));
    const file = form.get('file');
    if (!(file instanceof File))
      throw new OrganizationApiError(400, 'file_required', 'Selecciona un archivo.');
    const { user, service } = await authorizeOrganizationRequest(
      request,
      workspaceId,
      'kyb.manage'
    );
    if (!allowedMimeTypes.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      throw new OrganizationApiError(
        400,
        'invalid_kyb_file',
        'Usa un PDF o imagen válido de hasta 10 MB.'
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasExpectedSignature(bytes, file.type))
      throw new OrganizationApiError(
        400,
        'invalid_file_signature',
        'El contenido del archivo no coincide con su formato.'
      );
    const hash = createHash('sha256').update(bytes).digest('hex');
    const previous = await service
      .from('organization_kyb_evidence')
      .select('id,version')
      .eq('workspace_id', workspaceId)
      .eq('document_type', documentType)
      .neq('status', 'superseded')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous.error) throw previous.error;
    const version = Number(previous.data?.version || 0) + 1;
    const storagePath = `${workspaceId}/${documentType}/${new Date().getUTCFullYear()}/${randomUUID()}.${extensions[file.type]}`;
    const uploaded = await service.storage
      .from('organization-kyb')
      .upload(storagePath, bytes, { contentType: file.type, upsert: false, cacheControl: '0' });
    if (uploaded.error) throw uploaded.error;
    const inserted = await service
      .from('organization_kyb_evidence')
      .insert({
        workspace_id: workspaceId,
        document_type: documentType,
        display_name:
          file.name.trim().slice(0, 240) || `evidencia-${documentType}.${extensions[file.type]}`,
        storage_path: storagePath,
        mime_type: file.type,
        byte_size: file.size,
        sha256: hash,
        version,
        replaces_id: previous.data?.id || null,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (inserted.error) {
      await service.storage.from('organization-kyb').remove([storagePath]);
      throw inserted.error;
    }
    if (previous.data?.id) {
      const superseded = await service
        .from('organization_kyb_evidence')
        .update({ status: 'superseded' })
        .eq('workspace_id', workspaceId)
        .eq('id', previous.data.id);
      if (superseded.error) {
        await service.from('organization_kyb_evidence').delete().eq('id', inserted.data.id);
        await service.storage.from('organization-kyb').remove([storagePath]);
        throw superseded.error;
      }
    }
    await writeAudit(service, request, {
      workspace_id: workspaceId,
      actor_user_id: user.id,
      event_type: 'kyb.evidence.uploaded',
      resource_type: 'organization_kyb_evidence',
      resource_id: inserted.data.id,
      summary: 'Nueva versión de evidencia KYB almacenada',
      payload: { document_type: documentType, version, sha256: hash, byte_size: file.size },
      outcome: 'success',
      severity: 'high',
      module: 'kyb',
    });
    return Response.json({ success: true, id: inserted.data.id, version, sha256: hash });
  } catch (cause) {
    return organizationApiFailure(cause);
  }
}
