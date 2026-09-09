/**
 * Capacidades opcionales del flujo de firma autógrafa.
 *
 * La prueba de vida permanece implementada para una futura política de firma,
 * pero no forma parte del flujo estándar mientras esta capacidad siga apagada.
 */
export const autographSignatureCapabilities = {
  liveness: process.env.NEXT_PUBLIC_AUTOGRAPH_LIVENESS_ENABLED === 'true',
} as const;
