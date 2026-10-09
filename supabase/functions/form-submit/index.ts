import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requiresFormSignature } from '../_shared/form-signature-policy.ts';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const accessToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Inicia sesión para enviar el formulario.', code: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user || user.is_anonymous || !user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: 'Necesitas una cuenta con correo verificado para responder.', code: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { token, response_data } = await req.json();

    if (!token || !response_data) {
      return new Response(
        JSON.stringify({ error: 'token y response_data son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Validate token
    const { data: tokenRow, error: tokenError } = await supabase
      .from('form_tokens')
      .select('*, form_templates(*)')
      .eq('token', token)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: 'Token inválido', code: 'INVALID_TOKEN' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (
      tokenRow.recipient_email?.trim().toLowerCase() !== user.email?.trim().toLowerCase() ||
      (tokenRow.recipient_user_id && tokenRow.recipient_user_id !== user.id) ||
      (tokenRow.access_mode === 'public' && tokenRow.recipient_user_id !== user.id)
    ) {
      return new Response(JSON.stringify({ error: 'Este enlace pertenece a otra cuenta.', code: 'FORBIDDEN' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (tokenRow.form_templates?.status !== 'published') {
      return new Response(
        JSON.stringify({ error: 'Este formulario no está disponible.', code: 'FORM_UNAVAILABLE' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Token expirado', code: 'TOKEN_EXPIRED' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already used
    if (tokenRow.used_at) {
      return new Response(
        JSON.stringify({ error: 'Este formulario ya fue respondido', code: 'TOKEN_USED' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check rate limit
    if (tokenRow.attempts >= 3) {
      return new Response(
        JSON.stringify({ error: 'Demasiados intentos', code: 'RATE_LIMITED' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Increment attempts
    await supabase
      .from('form_tokens')
      .update({ attempts: tokenRow.attempts + 1 })
      .eq('id', tokenRow.id);

    // 2. Calculate SHA-256 hashes for each field value
    const fieldHashes: Record<string, string> = {};
    for (const [key, value] of Object.entries(response_data)) {
      const encoder = new TextEncoder();
      const data = encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      fieldHashes[key] = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // 3. Get client info
    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || null;
    const userAgent = req.headers.get('user-agent') || null;
    // 4. Save response
    const { data: responseRow, error: insertError } = await supabase
      .from('form_responses')
      .insert({
        token_id: tokenRow.id,
        template_id: tokenRow.template_id,
        workspace_id: tokenRow.form_templates.workspace_id,
        document_id: null,
        response_data,
        field_hashes: fieldHashes,
        respondent_email: user.email.trim().toLowerCase(),
        respondent_user_id: tokenRow.access_mode === 'public' ? user.id : null,
        ip_address: ipAddress,
        user_agent: userAgent,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.code === '23505' ? 'Este formulario ya fue respondido por tu cuenta.' : 'Error al guardar la respuesta', code: insertError.code === '23505' ? 'ALREADY_RESPONDED' : 'SAVE_FAILED' }),
        { status: insertError.code === '23505' ? 409 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Mark token as used
    await supabase
      .from('form_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id);

    // 6. Generate the mirror PDF from the same schema used by the web form.
    let generatedPdf: Record<string, unknown> | null = null;
    try {
      const generatorResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-form-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        },
        body: JSON.stringify({ response_id: responseRow.id }),
      });
      if (generatorResponse.ok) generatedPdf = await generatorResponse.json();
      else console.error('PDF generator error:', await generatorResponse.text());
    } catch (pdfError) {
      console.error('PDF generator error:', pdfError);
    }

    // 7. Keep the chosen signing method with the generated PDF.
    const hasPdf = !!tokenRow.form_templates.pdf_base_path;
    const requiresSignature = requiresFormSignature(
      tokenRow.form_templates.settings,
      tokenRow.form_templates.form_schema?.fields || tokenRow.form_templates.schema || []
    );
    if (requiresSignature && generatedPdf?.generated_pdf_id) {
      const signatureRequest = await supabase.from('signature_requests').insert({
        generated_pdf_id: generatedPdf.generated_pdf_id,
        workspace_id: responseRow.workspace_id,
        signer_name: tokenRow.recipient_name || tokenRow.recipient_email,
        signer_email: tokenRow.recipient_email,
        signer_role: tokenRow.signer_role || null,
        signature_type: tokenRow.signature_type || 'click_sign',
        require_liveness: tokenRow.require_liveness === true,
        expires_at: tokenRow.expires_at,
      });
      if (signatureRequest.error) console.error('Signature request error:', signatureRequest.error);
    }

    // Save a copy of the generated PDF in Mi espacio. A failed promotion is
    // retryable from the responses screen; the response itself remains saved.
    let documentId: string | null = null;
    if (generatedPdf?.generated_pdf_id) {
      try {
        const siteUrl = Deno.env.get('FORM_DOCUMENT_CALLBACK_URL') || Deno.env.get('NEXT_PUBLIC_SITE_URL');
        if (siteUrl) {
          const promotion = await fetch(`${siteUrl.replace(/\/$/, '')}/api/formularios/respuestas/${responseRow.id}/documento`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}` },
          });
          if (promotion.ok) documentId = (await promotion.json()).document_id || null;
          else console.error('Document promotion error:', await promotion.text());
        }
      } catch (promotionError) { console.error('Document promotion error:', promotionError); }
    }

    // 8. Trigger the legacy VPS mapper when a PDF base exists.
    if (hasPdf) {
      const vpsWebhookUrl = Deno.env.get('VPS_WEBHOOK_URL');
      if (vpsWebhookUrl) {
        try {
          await fetch(vpsWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              response_id: responseRow.id,
              template_schema: tokenRow.form_templates.schema,
              response_data,
              pdf_base_path: tokenRow.form_templates.pdf_base_path,
              workspace_id: tokenRow.form_templates.workspace_id,
            }),
          });
        } catch (webhookErr) {
          console.error('Webhook error:', webhookErr);
          // Non-fatal: continue
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        response_id: responseRow.id,
        document_id: documentId || responseRow.document_id || null,
        signature_required: requiresSignature,
        redirect_to_sign: false,
        generated_pdf: generatedPdf,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
