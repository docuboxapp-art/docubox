import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

function textField(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = String(fields[key] || '').trim();
    if (value) return value;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = String(body.token || '');
    if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

    const supabase = createServiceClient();
    const { data: tokenData, error: fetchError } = await supabase
      .from('enrollment_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (fetchError || !tokenData) return NextResponse.json({ error: 'Token no encontrado.' }, { status: 404 });
    if (new Date(tokenData.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Token expirado.', expired: true }, { status: 410 });
    }
    if (tokenData.status === 'completed') {
      return NextResponse.json({ error: 'El token ya fue utilizado.' }, { status: 409 });
    }
    if (tokenData.processing_status !== 'validated') {
      return NextResponse.json({
        error: 'La identidad y la prueba de vida deben validarse antes de completar el enrolamiento.',
        code: 'IDENTITY_NOT_VALIDATED',
      }, { status: 422 });
    }

    const metadata = (tokenData.document_metadata || {}) as Record<string, unknown>;
    const fields = (metadata.document_fields || {}) as Record<string, unknown>;
    const nombre = textField(fields, 'nombre', 'nombres', 'given_names');
    const apellidoPaterno = textField(fields, 'apellido_paterno', 'primer_apellido', 'family_name');
    const apellidoMaterno = textField(fields, 'apellido_materno', 'segundo_apellido');
    const curp = textField(fields, 'curp');
    const rfc = textField(fields, 'rfc');
    const fechaNacimiento = textField(fields, 'fecha_nacimiento', 'birth_date');
    const sexo = textField(fields, 'sexo', 'sex');
    const tipoIdentificacion = textField(fields, 'tipo_identificacion', 'document_type')
      || String(metadata.tipo_documento || '');
    if (!nombre || (!curp && !rfc)) {
      return NextResponse.json({
        error: 'El proveedor no devolvio los datos minimos de identidad.',
        code: 'IDENTITY_FIELDS_INCOMPLETE',
      }, { status: 422 });
    }

    const { data: resultData, error: resultError } = await supabase.rpc('complete_identity_enrollment', {
      p_token: token,
      p_result: {
      nombre,
      apellido_paterno: apellidoPaterno,
      apellido_materno: apellidoMaterno,
      curp,
      rfc,
      fecha_nacimiento: fechaNacimiento,
      sexo,
      tipo_identificacion: tipoIdentificacion,
      document_metadata: metadata,
      provider_reference: {
        provider: metadata.provider || null,
        provider_reference: metadata.provider_reference || null,
        correlation_id: metadata.correlation_id || null,
      },
    },
    }).single<{ enrollment_result_id: string }>();
    if (resultError || !resultData) {
      console.error('[complete] Atomic completion failed:', resultError?.code);
      return NextResponse.json({ error: 'No fue posible registrar el resultado del enrolamiento.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, enrollmentResultId: resultData.enrollment_result_id });
  } catch (error) {
    console.error('[complete] Failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'No fue posible completar el enrolamiento.' }, { status: 500 });
  }
}
