/**
 * Capacidades opcionales del flujo de firma autógrafa.
 *
 * La verificación de identidad (prueba de vida y OTP) permanece implementada
 * para una futura política de firma, pero no forma parte del flujo estándar
 * mientras esta capacidad siga apagada.
 */
export const autographSignatureCapabilities = {
  identityVerification:
    process.env.NEXT_PUBLIC_AUTOGRAPH_IDENTITY_VERIFICATION_ENABLED === 'true',
} as const;
