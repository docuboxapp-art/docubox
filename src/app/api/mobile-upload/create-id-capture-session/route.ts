import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'node:crypto';
import { captureEncryptionKey } from '@/lib/identity/capture-crypto';
import { findStoredIdentity } from '@/lib/identity/stored-identity';
import { documentAccessResponse, requireDocumentAccess } from '@/lib/security/document-access';
import { PublicCodeError, verifyPublicCode } from '@/lib/forms/public-code-access';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    let user: { id: string };
    let formId: string | null = null;
    if (documentId) {
      ({ user } = await requireDocumentAccess(req, documentId));
    } else {
      const access = await verifyPublicCode(supabase, req, body);
      if (!access.userId)
        return NextResponse.json({ error: 'Completa el alta express antes de la prueba de vida.' }, { status: 409 });
      user = { id: access.userId };
      formId = access.formId;
    }
    const key = captureEncryptionKey();
    if (!key) {
      return NextResponse.json(
        { error: 'El cifrado biométrico no está configurado.' },
        { status: 503 }
      );
    }
    const storedIdentity = await findStoredIdentity(supabase, user.id, key);
    const hasStoredId = Boolean(storedIdentity?.front);

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
          ...(formId ? { recipient_email: String(body.email).trim().toLowerCase() } : {}),
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
    if (err instanceof PublicCodeError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[create-id-capture-session] Unexpected error:', err);
    const response = documentAccessResponse(err);
    return NextResponse.json(response.body, { status: response.status });
  }
}
