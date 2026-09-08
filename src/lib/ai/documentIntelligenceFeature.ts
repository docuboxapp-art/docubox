export const DOCUMENT_INTELLIGENCE_DISABLED_MESSAGE =
  'La inteligencia documental aún no está activa en este entorno.';

export function isDocumentIntelligenceEnabled() {
  return process.env.LUCIA_DOCUMENT_INTELLIGENCE_ENABLED === 'true';
}
