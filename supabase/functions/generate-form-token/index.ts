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
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));

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
      expiration_hours = 72,
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

    const expiration = Number(expiration_hours);
    if (!Number.isFinite(expiration) || expiration < 1 / 60 || expiration > 720) {
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
    if (template.settings?.accessMode === 'public') {
      return new Response(JSON.stringify({ error: 'Este formulario utiliza enlace público. Comparte su enlace en lugar de enviar una invitación privada.' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    // Generate token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = new Date(Date.now() + expiration * 60 * 60 * 1000).toISOString();
    const ipIssued = req.headers.get('x-forwarded-for') || null;

    // Insert token
    const { data: tokenRow, error: insertError } = await supabase
      .from('form_tokens')
      .insert({
        template_id,
        access_mode: 'private',
        recipient_email,
        recipient_name: recipient_name || null,
        signer_role: signer_role || null,
        signature_type,
        require_liveness,
        token,
        expires_at: expiresAt,
        ip_issued: ipIssued,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'Error al crear el token' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const siteUrl = Deno.env.get('NEXT_PUBLIC_SITE_URL') || 'https://app.docubox.mx';
    const formUrl = `${siteUrl}/portal-formulario/${token}`;

    // Send email via Resend
    try {
        const workspaceName = (template.workspaces as { name: string })?.name || 'DOCUBOX';
        const expiresDate = new Date(expiresAt).toLocaleDateString('es-MX', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'DOCUBOX <noreply@docubox.mx>',
            to: [String(recipient_email).trim()],
            subject: `${workspaceName} te ha enviado un formulario: ${template.name}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #1a56db;">Tienes un formulario pendiente</h2>
                <p>Hola ${escapeHtml(recipient_name)},</p>
                <p><strong>${escapeHtml(workspaceName)}</strong> te ha enviado el formulario <strong>"${escapeHtml(template.name)}"</strong> para que lo completes.</p>
                <p>Al registrar tu respuesta se generará una solicitud de firma.</p>
                ${require_liveness ? '<p>La solicitud de firma incluirá una prueba de vida.</p>' : ''}
                <p style="color: #6b7280; font-size: 14px;">Este enlace expira el ${expiresDate}.</p>
                <div style="margin: 32px 0;">
                  <a href="${escapeHtml(formUrl)}" style="background-color: #1a56db; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
                    Completar formulario →
                  </a>
                </div>
                <p style="color: #9ca3af; font-size: 12px;">Si no esperabas este correo, puedes ignorarlo.</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 11px;">Powered by DOCUBOX</p>
              </div>
            `,
          }),
        });
        if (!emailResponse.ok) throw new Error(`Resend respondió ${emailResponse.status}`);
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
