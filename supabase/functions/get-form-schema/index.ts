import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formAccessDenial } from '../_shared/form-access-policy.ts';

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

    const accessToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Inicia sesión para responder el formulario.', code: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user || user.is_anonymous || !user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: 'Necesitas una cuenta con correo verificado para responder.', code: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validate token
    const { data: tokenRow, error: tokenError } = await supabase
      .from('form_tokens')
      .select('*, form_templates(id, name, description, status, schema, settings, workspace_id, workspaces(name, logo_url))')
      .eq('token', token)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: 'Token inválido o no encontrado', code: 'INVALID_TOKEN' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const template = tokenRow.form_templates as {
      id: string;
      name: string;
      description: string;
      status: string;
      schema: unknown[];
      settings: Record<string, unknown>;
      workspace_id: string;
      workspaces: { name: string; logo_url?: string };
    };

    const accessDenial = formAccessDenial(tokenRow, user);
    if (accessDenial === 'FORBIDDEN') {
      return new Response(JSON.stringify({ error: 'Este enlace pertenece a otra cuenta.', code: 'FORBIDDEN' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (accessDenial === 'LIVENESS_REQUIRED') {
      return new Response(JSON.stringify({ error: 'La prueba de vida es obligatoria antes de abrir este formulario.', code: 'LIVENESS_REQUIRED' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // A used invitation may still need signing. Return its document only to
    // the authenticated recipient, even when the original deadline has passed.
    if (tokenRow.used_at) {
      const { data: responseRow, error: responseError } = await supabase
        .from('form_responses')
        .select('id,document_id,status')
        .eq('token_id', tokenRow.id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (responseError) throw responseError;
      const { data: documentRow, error: documentError } = responseRow
        ? await supabase.from('documentos')
            .select('id,estado')
            .eq('source_form_response_id', responseRow.id)
            .maybeSingle()
        : { data: null, error: null };
      if (documentError) throw documentError;
      return new Response(
        JSON.stringify({
          error: 'Este formulario ya fue respondido',
          code: 'TOKEN_USED',
          used_at: tokenRow.used_at,
          response_id: responseRow?.id || null,
          response_status: responseRow?.status || null,
          document_id: documentRow?.id || responseRow?.document_id || null,
          document_state: documentRow?.estado || null,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Este enlace ha expirado', code: 'TOKEN_EXPIRED' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!template || template.status !== 'published') {
      return new Response(
        JSON.stringify({ error: 'Este formulario no está disponible.', code: 'FORM_UNAVAILABLE' }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let documentTypeName = typeof template.settings?.documentTypeName === 'string'
      ? template.settings.documentTypeName : '';
    const documentTypeId = typeof template.settings?.documentTypeId === 'string'
      ? template.settings.documentTypeId : '';
    if (!documentTypeName && documentTypeId) {
      const { data: documentType } = await supabase.from('tipo_documento')
        .select('nombre').eq('id', documentTypeId).maybeSingle();
      documentTypeName = documentType?.nombre || '';
    }

    // The recipient has already been authenticated and matched to this token.
    // Verified profile data takes precedence over launcher-supplied suggestions.
    const fields = Array.isArray(template.schema) ? template.schema : [];
    const hasPersonalFields = fields.some((field) =>
      field && typeof field === 'object' &&
      ['rfc', 'curp', 'business_name', 'person_first_name', 'person_last_name', 'person_second_last_name', 'fiscal_address'].includes((field as { type?: string }).type || '')
    );
    let participantProfile = null;
    if (hasPersonalFields) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('full_name,nombre,apellido_paterno,apellido_materno,personalidad_juridica,rfc,curp,calle,num_exterior,num_interior,colonia,municipio,localidad,estado')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      participantProfile = data;
    }

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
          requiresSignature: true,
          allowedSignatureTypes: template.settings?.allowedSignatureTypes || [],
          requireOtp: template.settings?.requireOtp ?? false,
          pdfSchema: template.settings?.pdfSchema || {},
          appearance: template.settings?.appearance || {},
          documentNumber: template.settings?.documentNumber || '',
          documentTypeId,
          documentTypeName,
        },
        workspaceName: template.workspaces?.name || 'DOCUBOX',
        workspaceLogo: template.workspaces?.logo_url || null,
        expiresAt: tokenRow.expires_at,
        recipientName: tokenRow.recipient_name || null,
        participantProfile: participantProfile || null,
        launchPrefill: tokenRow.launch_prefill && typeof tokenRow.launch_prefill === 'object'
          ? tokenRow.launch_prefill : {},
        signatureType: ['click_sign', 'autografa_digital', 'efirma_sat'].includes(tokenRow.signature_type)
          ? tokenRow.signature_type : 'click_sign',
        requireLiveness: tokenRow.require_liveness === true && !tokenRow.liveness_verified_at,
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
