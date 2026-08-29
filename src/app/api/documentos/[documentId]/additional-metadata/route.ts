import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RFC_PATTERN = /^[A-Z&Ñ]{3,4}\d{6}[A-Z\d]{3}$/i;
const CURP_PATTERN = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/i;

async function authorize(req: NextRequest, documentId: string) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };

  const { data: document, error: documentError } = await supabaseAdmin
    .from('documentos')
    .select('id, owner_id, workspace_id')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError || !document) return { error: NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 }) };

  const { data: membership } = await supabaseAdmin
    .from('workspace_members')
    .select('role,status')
    .eq('workspace_id', document.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || (membership.status && membership.status !== 'active')) {
    return { error: NextResponse.json({ error: 'No tienes acceso a este documento' }, { status: 403 }) };
  }

  return { user, document, membership };
}

function validateValue(dataType: string, value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'boolean') return 'El valor no es válido.';
  const stringValue = typeof value === 'string' ? value.trim() : value;
  if (dataType !== 'boolean' && !stringValue) return 'El valor es obligatorio.';
  if (typeof stringValue === 'string' && stringValue.length > 2000) return 'El valor es demasiado largo.';
  if (['number', 'currency'].includes(dataType) && (typeof stringValue !== 'string' || !Number.isFinite(Number(stringValue)))) return 'El valor debe ser numérico.';
  if (dataType === 'date' && (typeof stringValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stringValue) || Number.isNaN(Date.parse(`${stringValue}T00:00:00Z`)))) return 'La fecha no es válida.';
  if (dataType === 'datetime' && (typeof stringValue !== 'string' || Number.isNaN(Date.parse(stringValue)))) return 'La fecha y hora no son válidas.';
  if (dataType === 'email' && (typeof stringValue !== 'string' || !EMAIL_PATTERN.test(stringValue))) return 'El correo no es válido.';
  if (dataType === 'rfc' && (typeof stringValue !== 'string' || !RFC_PATTERN.test(stringValue))) return 'El RFC no es válido.';
  if (dataType === 'curp' && (typeof stringValue !== 'string' || !CURP_PATTERN.test(stringValue))) return 'La CURP no es válida.';
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const authorization = await authorize(req, documentId);
  if ('error' in authorization) return authorization.error;

  const { data, error } = await supabaseAdmin
    .from('document_additional_metadata')
    .select('id,metadata_scope,data_type,name,value_json,value_display,document_version_id,document_version_number,locked_at,created_at,updated_at')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const canManage = authorization.document.owner_id === authorization.user.id || ['owner', 'admin'].includes(authorization.membership.role || '');
  return NextResponse.json({ metadata: data || [], canManage });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const authorization = await authorize(req, documentId);
  if ('error' in authorization) return authorization.error;

  const canManage = authorization.document.owner_id === authorization.user.id || ['owner', 'admin'].includes(authorization.membership.role || '');
  if (!canManage) return NextResponse.json({ error: 'No tienes permiso para editar metadatos de gestión.' }, { status: 403 });

  const { id, value } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'El metadato es requerido.' }, { status: 400 });

  const { data: metadata, error: metadataError } = await supabaseAdmin
    .from('document_additional_metadata')
    .select('id,metadata_scope,data_type,name,value_json')
    .eq('id', id)
    .eq('document_id', documentId)
    .maybeSingle();
  if (metadataError || !metadata) return NextResponse.json({ error: 'Metadato no encontrado.' }, { status: 404 });
  if (metadata.metadata_scope !== 'management') return NextResponse.json({ error: 'Los metadatos del documento están bloqueados al iniciar la firma.' }, { status: 409 });

  const validationError = validateValue(metadata.data_type, value);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const normalizedValue = typeof value === 'string' ? value.trim() : value;
  const displayValue = normalizedValue === true ? 'Sí' : normalizedValue === false ? 'No' : normalizedValue;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('document_additional_metadata')
    .update({ value_json: normalizedValue, value_display: displayValue, updated_by: authorization.user.id })
    .eq('id', metadata.id)
    .select('id,metadata_scope,data_type,name,value_json,value_display,document_version_id,document_version_number,locked_at,created_at,updated_at')
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await supabaseAdmin.from('document_activity_log').insert({
    documento_id: documentId,
    actor_id: authorization.user.id,
    actor_nombre: authorization.user.user_metadata?.full_name || null,
    actor_email: authorization.user.email || null,
    action: 'MANAGEMENT_METADATA_UPDATED',
    category: 'metadatos',
    details: { metadata_id: metadata.id, name: metadata.name, previous_value: metadata.value_json, updated_value: normalizedValue },
  });

  return NextResponse.json({ metadata: updated });
}
