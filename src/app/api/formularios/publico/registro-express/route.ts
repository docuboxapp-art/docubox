import { createPrivateKey, randomBytes, sign, verify, X509Certificate } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { PublicCodeError, verifyPublicCode } from '@/lib/forms/public-code-access';
import { hashCapabilityToken } from '@/lib/security/capability-token';
import { POST as registerUser } from '@/app/api/registro/register-user/route';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const fail = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers });

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const email = String(form.get('email') || '')
      .trim()
      .toLowerCase();
    const code = String(form.get('code') || '');
    const formId = String(form.get('formId') || '');
    const password = String(form.get('password') || '');
    const personality = String(form.get('personality') || '');
    if (!['fisica', 'moral'].includes(personality))
      return fail('Elige persona física o moral.', 400);
    if (password.length < 8 || password.length > 128)
      return fail('Crea una contraseña de 8 a 128 caracteres.', 400);
    if (form.get('accepted') !== 'true')
      return fail('Acepta los términos para crear la cuenta.', 400);
    const service = createServiceClient();
    const access = await verifyPublicCode(service, request, { email, code, formId });
    if (!access.recipientBound)
      return fail('Solicita una invitación con código individual para el alta express.', 409);
    if (access.userId)
      return fail('Ya existe una cuenta con este correo. Continúa con la prueba de vida.', 409);

    let registration: Record<string, unknown>;
    if (personality === 'fisica') {
      const sessionId = String(form.get('enrollmentSessionId') || '');
      const enrollmentToken = String(form.get('enrollmentToken') || '');
      if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^[a-f0-9]{64}$/i.test(enrollmentToken))
        return fail('Completa el enrolamiento desde el móvil.', 400);
      const { data: enrollmentAccess, error: tokenError } = await service
        .from('enrollment_tokens')
        .select('id,status,session_id')
        .eq('token_hash', hashCapabilityToken(enrollmentToken))
        .eq('session_id', sessionId)
        .maybeSingle();
      if (tokenError) return fail('No se pudo comprobar el enrolamiento.', 503);
      if (!enrollmentAccess || enrollmentAccess.status !== 'completed')
        return fail('El enrolamiento no está completo.', 422);
      const { data: result, error } = await service
        .from('enrollment_results')
        .select(
          'nombre,apellido_paterno,apellido_materno,curp,rfc,fecha_nacimiento,sexo,tipo_identificacion,face_match_passed,user_id,created_at'
        )
        .eq('enrollment_token_id', enrollmentAccess.id)
        .eq('session_id', sessionId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return fail('No se pudo comprobar el enrolamiento.', 503);
      if (
        !result ||
        result.face_match_passed !== true ||
        result.user_id ||
        Date.now() - new Date(result.created_at).getTime() > 60 * 60_000
      )
        return fail('El enrolamiento no fue aprobado o ya expiró.', 422);
      const fullName = [result.nombre, result.apellido_paterno, result.apellido_materno]
        .filter(Boolean)
        .join(' ');
      if (!fullName) return fail('No se pudo obtener el nombre de la identificación.', 422);
      registration = {
        fullName,
        nombre: result.nombre,
        apellidoPaterno: result.apellido_paterno,
        apellidoMaterno: result.apellido_materno,
        curp: result.curp,
        rfc: result.rfc,
        fechaNacimiento: result.fecha_nacimiento,
        sexo: result.sexo,
        tipoIdentificacion: result.tipo_identificacion,
        documentType1: 'biometrico',
        documentType2: 'curp',
        enrollmentSessionId: sessionId,
        identityMethod: 'biometrico',
      };
    } else {
      const cer = form.get('cer');
      const key = form.get('key');
      const passphrase = String(form.get('efirmaPassword') || '');
      if (
        !(cer instanceof File) ||
        !(key instanceof File) ||
        !passphrase ||
        cer.size > 1_000_000 ||
        key.size > 1_000_000 ||
        !cer.name.toLowerCase().endsWith('.cer') ||
        !key.name.toLowerCase().endsWith('.key')
      )
        return fail('Carga los archivos .cer y .key del SAT y su contraseña.', 400);
      let certificate: X509Certificate;
      let privateKey: ReturnType<typeof createPrivateKey>;
      try {
        certificate = new X509Certificate(Buffer.from(await cer.arrayBuffer()));
        const keyBytes = Buffer.from(await key.arrayBuffer());
        try {
          privateKey = createPrivateKey({
            key: keyBytes,
            format: 'der',
            type: 'pkcs8',
            passphrase,
          });
        } catch {
          privateKey = createPrivateKey({ key: keyBytes, format: 'pem', passphrase });
        }
      } catch {
        return fail('La e.firma o su contraseña no son válidas.', 422);
      }
      const now = Date.now();
      if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now)
        return fail('El certificado de e.firma está fuera de vigencia.', 422);
      const challenge = randomBytes(32);
      if (
        !verify('sha256', challenge, certificate.publicKey, sign('sha256', challenge, privateKey))
      )
        return fail('La llave privada no corresponde al certificado.', 422);
      const rfc =
        certificate.subject.toUpperCase().match(/\b[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}\b/)?.[0] || '';
      if (!rfc)
        return fail('El certificado no corresponde a una persona moral con RFC válido.', 422);
      const fullName = certificate.subject.match(/(?:^|\n)CN\s*=\s*([^\n]+)/i)?.[1]?.trim() || rfc;
      registration = {
        fullName,
        rfc,
        efirmaRfc: rfc,
        efirmaSerial: certificate.serialNumber,
        efirmaNombre: fullName,
        efirmaVigenciaFin: certificate.validTo,
        documentType1: 'efirma_moral',
        identityMethod: 'efirma',
      };
    }

    const registrationRequest = new NextRequest(
      new URL('/api/registro/register-user', request.url),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          accountType: 'personal',
          personalidadJuridica: personality,
          ...registration,
        }),
      }
    );
    const response = await registerUser(registrationRequest);
    const result = await response.json();
    if (!response.ok || !result.success)
      return fail(result.error || 'No se pudo crear la cuenta.', response.status);
    return NextResponse.json(
      { success: true, personality, name: registration.fullName, warning: result.warning || null },
      { headers }
    );
  } catch (error) {
    if (error instanceof PublicCodeError) return fail(error.message, error.status);
    return fail('No se pudo completar el alta express.', 503);
  }
}
