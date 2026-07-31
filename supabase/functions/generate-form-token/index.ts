import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
      expiration_hours = 72,
    } = await req.json();

    if (!template_id || !recipient_email) {
      return new Response(
        JSON.stringify({ error: 'template_id y recipient_email son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify template belongs to user's workspace
    const { data: template, error: templateError } = await supabase
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

    // Generate token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = new Date(Date.now() + expiration_hours * 60 * 60 * 1000).toISOString();
    const ipIssued = req.headers.get('x-forwarded-for') || null;

    // Insert token
    const { data: tokenRow, error: insertError } = await supabase
      .from('form_tokens')
      .insert({
        template_id,
        recipient_email,
        recipient_name: recipient_name || null,
        signer_role: signer_role || null,
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
    const formUrl = `${siteUrl}/form/${token}`;

    // Send email via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey) {
      try {
        const workspaceName = (template.workspaces as { name: string })?.name || 'DOCUBOX';
        const expiresDate = new Date(expiresAt).toLocaleDateString('es-MX', {
          day: '2-digit', month: 'long', year: 'numeric',
        });

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'DOCUBOX <noreply@docubox.mx>',
            to: [recipient_email],
            subject: `${workspaceName} te ha enviado un formulario: ${template.name}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #1a56db;">Tienes un formulario pendiente</h2>
                <p>Hola${recipient_name ? ` ${recipient_name}` : ''},</p>
                <p><strong>${workspaceName}</strong> te ha enviado el formulario <strong>"${template.name}"</strong> para que lo completes.</p>
                <p style="color: #6b7280; font-size: 14px;">Este enlace expira el ${expiresDate}.</p>
                <div style="margin: 32px 0;">
                  <a href="${formUrl}" style="background-color: #1a56db; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">
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
      } catch (emailErr) {
        console.error('Email error:', emailErr);
        // Non-fatal
      }
    }

    return new Response(
      JSON.stringify({
        token,
        form_url: formUrl,
        expires_at: expiresAt,
        token_id: tokenRow.id,
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
