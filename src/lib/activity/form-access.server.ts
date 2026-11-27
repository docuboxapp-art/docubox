import 'server-only';

import {
  formAccessDenial,
  publicFormCapabilityDenial,
  type FormAccessToken,
} from '../../../supabase/functions/_shared/form-access-policy';
import { activityTime, formActivityState } from './model';

type AccessToken = Omit<FormAccessToken, 'liveness_verified_at'> & {
  liveness_verified_at?: string | null;
  used_at: string | null;
  expires_at: string | null;
};

type FormResponse = {
  id: string;
  status: string;
  submitted_at: string | null;
  document_id: string | null;
};

export function compareFormResponses(a: FormResponse, b: FormResponse) {
  return activityTime(b.submitted_at) - activityTime(a.submitted_at) || a.id.localeCompare(b.id);
}

export function formTokenAction(
  actor: { id: string; email: string },
  token: AccessToken,
  form: { status: string; requires_signature: boolean },
  response: FormResponse | undefined,
  now: number
) {
  const state = formActivityState({
    responseStatus: response?.status,
    submittedAt: response?.submitted_at,
    usedAt: token.used_at,
    requiresSignature: form.requires_signature,
    expiresAt: token.expires_at,
    templateStatus: form.status,
  }, now);
  const label = state.state === 'completed'
    ? 'Ver mi respuesta'
    : state.state === 'signature'
      ? 'Continuar firma'
      : 'Responder formulario';
  const disabled = (disabledReason: string, status = 409, canVerifyAgain = false) => ({
    kind: 'disabled', label, disabledReason, status, canVerifyAgain,
  } as const);

  if (state.state === 'completed' || state.state === 'signature') {
    if (response?.document_id && (response.submitted_at || response.status === 'signed')) {
      const route = state.state === 'signature' ? '/firmar-documento/' : '/visor-documento/';
      return { kind: 'document', label, documentUrl: `${route}${response.document_id}` } as const;
    }
    if (state.state === 'completed')
      return disabled('La respuesta está registrada. Aún no hay un documento para consultar.');
    if (!response?.submitted_at || !token.used_at)
      return disabled('La respuesta sigue en procesamiento. Vuelve a intentarlo más tarde.');
    // A consumed link opens the saved-response screen, where the PDF can be prepared again.
  } else if (state.state === 'expired') {
    return disabled('La invitación al formulario venció.', 410);
  } else if (state.state !== 'pending' && state.state !== 'in_progress') {
    return disabled(state.stateLabel);
  } else if (token.used_at) {
    return disabled('La respuesta sigue en procesamiento. Vuelve a intentarlo más tarde.');
  }

  const capability = { ...token, liveness_verified_at: token.liveness_verified_at ?? null };
  const denial = token.access_mode === 'public'
    ? publicFormCapabilityDenial(capability, now)
    : formAccessDenial(capability, actor);
  if (denial === 'LIVENESS_REQUIRED')
    return disabled('La verificación de identidad venció o está pendiente.', 409, !token.used_at);
  if (denial)
    return disabled('El enlace del formulario corresponde a otra cuenta o ya no está disponible.', 403);

  return { kind: 'token', label } as const;
}
