import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('DOCUBOX_ALLOWED_ORIGIN') || 'https://docubox.mx',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

serve((request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(JSON.stringify({
    error: 'INSECURE_KEY_GENERATOR_RETIRED',
    message: 'La generacion local de certificados fue retirada. Configura el proveedor KMS/HSM del motor de certificacion.',
    required_configuration: [
      'DOCUBOX_KMS_SIGN_URL',
      'DOCUBOX_KMS_VERIFY_URL',
      'DOCUBOX_KMS_TOKEN',
      'DOCUBOX_PDF_SIGN_URL',
      'DOCUBOX_PDF_VERIFY_URL',
      'DOCUBOX_TSA_URL',
    ],
  }), { status: 410, headers: corsHeaders });
});
