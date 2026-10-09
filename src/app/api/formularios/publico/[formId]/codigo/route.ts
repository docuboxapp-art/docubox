import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createPublicCode,
  decryptPublicCode,
  encryptPublicCode,
  hashPublicCode,
  publicCodeLookup,
} from '@/lib/forms/public-access-code';
import { resolveTemplatePublicationContext } from '@/lib/templates/publication-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

async function accessCode(request: NextRequest, context: { params: Promise<{ formId: string }> }, create: boolean) {
  const { formId } = await context.params;
  const jwt = request.headers
    .get('Authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!jwt) return NextResponse.json({ error: 'Inicia sesión.' }, { status: 401, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    return NextResponse.json({ error: 'Servicio no disponible.' }, { status: 503, headers });
  const service = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
  } = await service.auth.getUser(jwt);
  if (!user) return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401, headers });
  const { data: form } = await service
    .from('form_templates')
    .select('id,status,settings,created_by,workspace_id,allowed_signature_types')
    .eq('id', formId)
    .maybeSingle();
  if (!form || form.status !== 'published')
    return NextResponse.json(
      { error: 'No tienes acceso al código de este formulario.' },
      { status: 403, headers }
    );
  const contextForForm = await resolveTemplatePublicationContext(request, form.workspace_id).catch(
    () => null
  );
  if (
    !contextForForm ||
    contextForForm.user.id !== user.id ||
    (form.created_by !== user.id && !contextForForm.canManageResources)
  )
    return NextResponse.json(
      { error: 'No tienes acceso al código de este formulario.' },
      { status: 403, headers }
    );
  const { data: existing, error: lookupError } = await service
    .from('form_public_access_codes')
    .select('code_ciphertext')
    .eq('form_id', formId)
    .maybeSingle();
  if (lookupError)
    return NextResponse.json(
      { error: 'Falta aplicar la migración de códigos públicos.' },
      { status: 503, headers }
    );
  if (existing)
    return NextResponse.json({ code: decryptPublicCode(existing.code_ciphertext) }, { headers });
  if (!create)
    return NextResponse.json({ error: 'Este formulario aún no tiene un código público. Actívalo desde Lanzar formulario.' }, { status: 404, headers });
  const allowedTypes = Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
    ? form.allowed_signature_types : form.settings?.allowedSignatureTypes;
  if (Array.isArray(allowedTypes) && allowedTypes.length && !allowedTypes.includes('autografa_digital'))
    return NextResponse.json({ error: 'Habilita la firma autógrafa digital antes de activar el acceso público.' }, { status: 409, headers });
  const code = createPublicCode();
  const { error } = await service.from('form_public_access_codes').insert({
    form_id: formId,
    code_lookup: publicCodeLookup(code),
    code_hash: hashPublicCode(code),
    code_ciphertext: encryptPublicCode(code),
  });
  if (error?.code === '23505') {
    const { data: concurrent } = await service.from('form_public_access_codes')
      .select('code_ciphertext').eq('form_id', formId).maybeSingle();
    if (concurrent) return NextResponse.json({ code: decryptPublicCode(concurrent.code_ciphertext) }, { headers });
  }
  if (error)
    return NextResponse.json({ error: 'No se pudo generar el código.' }, { status: 503, headers });
  return NextResponse.json({ code }, { headers });
}

export async function GET(request: NextRequest, context: { params: Promise<{ formId: string }> }) {
  return accessCode(request, context, false);
}

export async function POST(request: NextRequest, context: { params: Promise<{ formId: string }> }) {
  return accessCode(request, context, true);
}
