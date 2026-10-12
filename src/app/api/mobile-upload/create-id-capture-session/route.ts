import { NextRequest, NextResponse } from 'next/server';
import { createAnonClient, createServiceClient } from '@/lib/supabase/server';
import crypto from 'node:crypto';
import { captureEncryptionKey } from '@/lib/identity/capture-crypto';
import { findStoredIdentity } from '@/lib/identity/stored-identity';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import {
  isValidPublicCode,
  matchesStoredPublicCode,
  normalizePublicCode,
  publicCodeLookup,
} from '@/lib/forms/public-access-code';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    const requestedFormId = typeof body.formId === 'string' ? body.formId : '';
    let user;
    let formId: string | null = null;
    if (documentId) {
      ({ user } = await requireDocumentAccess(req, documentId));
    } else {
      const accessToken = req.headers
        .get('authorization')
        ?.replace(/^Bearer\s+/i, '')
        .trim();
      if (!accessToken)
        return NextResponse.json({ error: 'Inicia sesión para continuar.' }, { status: 401 });
      const { data, error: authError } = await createAnonClient().auth.getUser(accessToken);
      user = data.user;
      if (authError || !user?.email || !user.email_confirmed_at || user.is_anonymous) {
        return NextResponse.json(
          { error: 'Necesitas una cuenta con correo verificado.' },
          { status: 401 }
        );
      }
      const code = normalizePublicCode(body.code);
      if (!isValidPublicCode(code))
        return NextResponse.json({ error: 'Código de acceso inválido.' }, { status: 400 });
      const lookup = publicCodeLookup(code);
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count, error: limitError } = await supabase
        .from('form_public_code_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('succeeded', false)
        .gte('created_at', since);
      if (limitError) throw limitError;
      if ((count || 0) >= 5) {
        return NextResponse.json(
          { error: 'Demasiados intentos. Espera 15 minutos.' },
          { status: 429 }
        );
      }
      const { data: access, error: accessError } = await supabase
        .from('form_public_access_codes')
        .select('form_id,code_lookup,code_hash,legacy_code_lookup,legacy_code_hash')
        .or(`code_lookup.eq.${lookup},legacy_code_lookup.eq.${lookup}`)
        .maybeSingle();
      if (accessError) throw accessError;
      const valid = Boolean(
        access &&
        matchesStoredPublicCode(code, access) &&
        (!requestedFormId || requestedFormId === access.form_id)
      );
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const { error: attemptError } = await supabase.from('form_public_code_attempts').insert({
        code_lookup: lookup,
        user_id: user.id,
        ip_hash: crypto.createHash('sha256').update(ip).digest('hex'),
        succeeded: valid,
      });
      if (attemptError) throw attemptError;
      if (!valid || !access) {
        return NextResponse.json(
          { error: 'El código no corresponde a este formulario.' },
          { status: 403 }
        );
      }
      const { data: form, error: formError } = await supabase
        .from('form_templates')
        .select('status,settings,allowed_signature_types')
        .eq('id', access.form_id)
        .maybeSingle();
      if (formError) throw formError;
      if (form?.status !== 'published') {
        return NextResponse.json(
          { error: 'Este formulario ya no está disponible.' },
          { status: 404 }
        );
      }
      const allowedTypes =
        Array.isArray(form.allowed_signature_types) && form.allowed_signature_types.length
          ? form.allowed_signature_types
          : form.settings?.allowedSignatureTypes;
      if (
        Array.isArray(allowedTypes) &&
        allowedTypes.length &&
        !allowedTypes.includes('autografa_digital')
      ) {
        return NextResponse.json(
          { error: 'La firma autógrafa no está habilitada para este formulario.' },
          { status: 409 }
        );
      }
      formId = access.form_id;
    }
    const key = captureEncryptionKey();
    if (!key) {
      return NextResponse.json(
        { error: 'El cifrado biométrico no está configurado.' },
        { status: 503 }
      );
    }
    const hasStoredId = Boolean(await findStoredIdentity(supabase, user.id, key));

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { data, error } = await supabase
      .from('mobile_upload_sessions')
      .insert({
        token: sessionToken,
        user_id: user.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        metadata: {
          mode: formId ? 'public_form_liveness' : 'id_capture',
          document_id: documentId || null,
          form_id: formId,
          user_id: user.id,
          has_enrollment: hasStoredId,
        },
      })
      .select()
      .single();

    if (error) {
      console.error('[create-id-capture-session] Supabase error:', error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    return NextResponse.json({
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
      sessionId: data.id,
      hasStoredId,
    });
  } catch (err: unknown) {
    console.error('[create-id-capture-session] Unexpected error:', err);
    const response = documentAccessResponse(err);
    return NextResponse.json(response.body, { status: response.status });
  }
}
