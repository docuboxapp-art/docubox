import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requiresFormSignature } from '../_shared/form-signature-policy.ts';
import { getClientIp } from '../_shared/client-ip.ts';
import { buildFormEmail } from '../_shared/form-email-template.ts';

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
    // Requires JWT auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user JWT
    const userSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userSupabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Token JWT inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const {
      template_id,
      recipient_email,
      recipient_name,
      signer_role,
      signature_type,
      require_liveness = false,
      notification_method = 'email',
      expiration_hours = null,
    } = await req.json();

    if (!template_id || !recipient_name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipient_email || '').trim()) || notification_method !== 'email') {
      return new Response(
        JSON.stringify({ error: 'Selecciona un participante con nombre y correo electrónico válidos.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (typeof require_liveness !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'La opción de prueba de vida debe ser verdadera o falsa.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const recipientEmail = String(recipient_email).trim().toLowerCase();

    const expiration = expiration_hours == null ? null : Number(expiration_hours);
    if (expiration !== null && (!Number.isFinite(expiration) || expiration < 1 / 60 || expiration > 720)) {
      return new Response(
        JSON.stringify({ error: 'La vigencia debe estar entre 1 minuto y 720 horas.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify template belongs to user's workspace
    const { data: template, error: templateError } = await userSupabase
      .from('form_templates')
      .select('*, workspaces(name, logo_url)')
      .eq('id', template_id)
      .single();

    if (templateError || !template) {
      return new Response(
        JSON.stringify({ error: 'Formulario no encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (template.status !== 'published') {
      return new Response(
        JSON.stringify({ error: 'El formulario no está publicado.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const requiresSignature = requiresFormSignature(template.settings, template.form_schema?.fields || template.schema || []);
    const validSignatureTypes = ['click_sign', 'autografa_digital', 'efirma_sat'];
    const allowedSignatureTypes = template.allowed_signature_types?.length
      ? template.allowed_signature_types
      : template.settings?.allowedSignatureTypes?.length
        ? template.settings.allowedSignatureTypes
        : validSignatureTypes;
    if (requiresSignature && (!validSignatureTypes.includes(signature_type) || !allowedSignatureTypes.includes(signature_type))) {
      return new Response(JSON.stringify({ error: 'Selecciona un tipo de firma permitido para este formulario.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) return new Response(JSON.stringify({ error: 'El envío por correo no está configurado.' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: launcherProfile, error: launcherProfileError } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (launcherProfileError) throw launcherProfileError;
    const launcherName = String(launcherProfile?.full_name || user.user_metadata?.full_name || user.email || 'Usuario de Docubox').replace(/[\r\n]+/g, ' ').trim();
    const sentToSelf = Boolean(user.email && user.email.trim().toLowerCase() === recipientEmail);

    // Generate token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = template.settings?.configureLinkExpiration === true && expiration !== null
      ? new Date(Date.now() + expiration * 60 * 60 * 1000).toISOString() : null;
    const ipIssued = getClientIp(req.headers);

    // Insert token
    const { data: tokenRow, error: insertError } = await supabase
      .from('form_tokens')
      .insert({
        template_id,
        access_mode: 'private',
        recipient_email: recipientEmail,
        recipient_name: recipient_name || null,
        signer_role: signer_role || null,
        signature_type,
        require_liveness,
        launched_by_user_id: user.id,
        launcher_name: launcherName,
        sent_to_self: sentToSelf,
        token,
        expires_at: expiresAt,
        ip_issued: ipIssued,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Form token insert failed:', insertError.code, insertError.message);
      return new Response(
        JSON.stringify({ error: 'Error al crear el token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let siteUrl = 'https://docubox-docubox.vercel.app';
    try {
      const configuredUrl = new URL(Deno.env.get('NEXT_PUBLIC_SITE_URL') || siteUrl);
      if (configuredUrl.protocol === 'https:' && configuredUrl.hostname !== 'app.docubox.mx') {
        siteUrl = configuredUrl.origin;
      }
    } catch {
      // Keep the working production URL when the configured URL is invalid.
    }
    const formUrl = `${siteUrl}/portal-formulario/${token}`;

    // Send email via Resend
    try {
        const workspaceName = (template.workspaces as { name: string })?.name || 'DOCUBOX';
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: Deno.env.get('RESEND_FROM_EMAIL') || 'Docubox <noreply@docubox.com.mx>',
            to: [recipientEmail],
            subject: sentToSelf ? `Tienes un formulario por completar: ${template.name}` : `${launcherName} te ha enviado un formulario: ${template.name}`,
            html: buildFormEmail({
              variant: 'invitation',
              recipientName: String(recipient_name).trim(),
              formName: template.name,
              workspaceName,
              requesterName: launcherName,
              sentToSelf,
              formUrl,
              expiresAt,
              requireLiveness: require_liveness,
            }),
          }),
        });
        if (!emailResponse.ok) {
          const providerError = await emailResponse.json().catch(() => null);
          const detail = providerError && typeof providerError === 'object'
            ? [providerError.name, providerError.message].filter((value) => typeof value === 'string').join(': ')
            : '';
          throw new Error(`Resend respondió ${emailResponse.status}${detail ? `: ${detail}` : ''}`);
        }
      } catch (emailErr) {
        console.error('Email error:', emailErr);
        await supabase.from('form_tokens').delete().eq('id', tokenRow.id);
        return new Response(JSON.stringify({ error: 'No se pudo entregar el correo. Revisa la configuración de envío e inténtalo de nuevo.' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

    return new Response(
      JSON.stringify({
        token,
        form_url: formUrl,
        expires_at: expiresAt,
        token_id: tokenRow.id,
        email_sent: true,
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
