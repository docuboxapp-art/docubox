import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'token es requerido' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      (globalThis.Deno?.env.get('SUPABASE_URL')) ?? '',
      (globalThis.Deno?.env.get('SUPABASE_SERVICE_ROLE_KEY')) ?? ''
    );

    // Validate token
    const { data: tokenRow, error: tokenError } = await supabase
      .from('form_tokens')
      .select('*, form_templates(id, name, description, schema, settings, workspace_id, workspaces(name, logo_url))')
      .eq('token', token)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: 'Token inválido o no encontrado', code: 'INVALID_TOKEN' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Este enlace ha expirado', code: 'TOKEN_EXPIRED' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already used
    if (tokenRow.used_at) {
      return new Response(
        JSON.stringify({ error: 'Este formulario ya fue respondido', code: 'TOKEN_USED', used_at: tokenRow.used_at }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const template = tokenRow.form_templates as {
      id: string;
      name: string;
      description: string;
      schema: unknown[];
      settings: Record<string, unknown>;
      workspace_id: string;
      workspaces: { name: string; logo_url?: string };
    };

    // Return schema without sensitive workspace data
    return new Response(
      JSON.stringify({
        templateId: template.id,
        name: template.name,
        description: template.description || '',
        fields: Array.isArray(template.schema) ? template.schema : [],
        settings: {
          mode: template.settings?.mode || 'scroll',
          multiStep: template.settings?.multiStep || false,
          language: template.settings?.language || 'es',
          sections: template.settings?.sections || [],
          allowSaveProgress: template.settings?.allowSaveProgress ?? false,
          requiresSignature: template.settings?.requiresSignature ?? false,
          allowedSignatureTypes: template.settings?.allowedSignatureTypes || [],
          requireOtp: template.settings?.requireOtp ?? false,
          pdfSchema: template.settings?.pdfSchema || {},
        },
        workspaceName: template.workspaces?.name || 'DOCUBOX',
        workspaceLogo: template.workspaces?.logo_url || null,
        expiresAt: tokenRow.expires_at,
        recipientName: tokenRow.recipient_name || null,
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
