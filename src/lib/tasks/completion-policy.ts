/** Completion rules shared by the task API and its contract tests. */
export const VERIFIED_TASK_TARGETS = {
  retomar_borrador: ['document'],
  firmar_documento: ['document'],
  responder_formulario: ['form_token'],
  validar_identidad: ['user'],
  cerrar_expediente: ['case_file'],
  subir_anexo: ['participant_requirement'],
  obtener_nom151: ['document'],
} as const;

export type CompletionMode = 'verified' | 'attested';

export function completionMode(type: string, sourceType: string | null): CompletionMode {
  const targets = VERIFIED_TASK_TARGETS[type as keyof typeof VERIFIED_TASK_TARGETS] as readonly string[] | undefined;
  return targets?.includes(sourceType || '') ? 'verified' : 'attested';
}

export function completionAttestationIsValid(reason: string | undefined): boolean {
  return Boolean(reason && reason.trim().length >= 15 && reason.trim().length <= 1000);
}
