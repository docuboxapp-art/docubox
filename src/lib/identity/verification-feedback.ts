/** Safe, provider-independent feedback. Never expose provider messages or biometric data. */
export const verificationFailureMessages = {
  DOCUMENT_NOT_VALID:
    'No se pudo validar la identificación. Regresa y genera un QR nuevo para repetir la captura.',
  IDENTITY_MISMATCH:
    'La identificación no coincide con los datos del usuario registrado. Revisa tu identificación antes de generar un QR nuevo.',
  FACE_NOT_MATCHED:
    'No se pudo confirmar la coincidencia del rostro con la identificación. Genera un QR nuevo y repite la captura con buena iluminación.',
  LIVENESS_SPOOF_DETECTED:
    'La captura no fue reconocida como una prueba de vida válida. Genera un QR nuevo y captura tu rostro directamente con la cámara, con luz uniforme y sin filtros.',
  LIVENESS_NO_FACE:
    'No se detectó un rostro en la prueba de vida. Genera un QR nuevo y mantén tu rostro completo frente a la cámara.',
  LIVENESS_MULTIPLE_FACES:
    'Se detectó más de un rostro. Genera un QR nuevo y realiza la captura sin otras personas en la imagen.',
  LIVENESS_NOT_VERIFIED:
    'No se pudo aprobar la prueba de vida. Genera un QR nuevo y repite la captura con el rostro completo y buena iluminación.',
  VERIFICATION_NOT_APPROVED:
    'La verificación no fue aprobada. Regresa y genera un QR nuevo para repetirla.',
} as const;

export type VerificationFailureReason = keyof typeof verificationFailureMessages;

export function verificationFailureMessage(reason: unknown): string {
  return typeof reason === 'string' && Object.hasOwn(verificationFailureMessages, reason)
    ? verificationFailureMessages[reason as VerificationFailureReason]
    : verificationFailureMessages.VERIFICATION_NOT_APPROVED;
}
