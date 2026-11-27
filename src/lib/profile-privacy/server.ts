import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

const failures: Record<string, [number, string]> = {
  profile_unavailable: [404, 'La información solicitada no está disponible.'],
  profile_requests_closed: [403, 'Esta cuenta no está recibiendo solicitudes de contacto.'],
  profile_request_changed: [409, 'La solicitud cambió. Actualiza la lista para ver su estado.'],
  profile_contact_not_registered: [404, 'Este contacto no tiene una cuenta de Docubox disponible.'],
  profile_communication_closed: [403, 'La persona no está recibiendo este tipo de comunicación.'],
  profile_contact_consent_required: [403, 'Para agregar a esa persona necesitas su aprobación.'],
  profile_invalid_visibility: [422, 'Revisa las opciones de visibilidad e inténtalo de nuevo.'],
  profile_privacy_update_required: [409, 'Actualiza la página para editar tu visibilidad.'],
  PGRST202: [503, 'La configuración de privacidad aún no está disponible en este entorno.'],
  '42883': [503, 'La configuración de privacidad aún no está disponible en este entorno.'],
};

export class ProfilePrivacyError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export async function runProfilePrivacy(
  actor: string,
  action: string,
  payload: object,
  signal?: AbortSignal
) {
  const deadline = AbortSignal.any([AbortSignal.timeout(9000), ...(signal ? [signal] : [])]);
  const { data, error } = await createServiceClient(deadline).rpc('docubox_profile_privacy', {
    p_actor: actor,
    p_action: action,
    p_payload: payload,
  });
  if (!error) return data;
  const [status, message] = failures[error.message] ||
    failures[error.code] || [503, 'No fue posible consultar la privacidad en este momento.'];
  throw new ProfilePrivacyError(status, message, error.code);
}
