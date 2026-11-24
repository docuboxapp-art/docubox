import { HELP_ROOT, type HelpFilters } from './model';

export const HELP_QUERY_LIMIT = 120;

// Shared URLs and suggestions use general search terms only.
export function cleanHelpQuery(value: unknown) {
  if (typeof value !== 'string') return '';
  return (
    value
      .slice(0, 512)
      .normalize('NFKC')
      .replace(
        /(?:https?:\/\/|www\.)\S+|\S+@\S+|\/(?:portal-participante|portal-formulario|expediente|firmar-documento|visor-documento)\/\S+/gi,
        ' '
      )
      .replace(/\b(otp|token|c[oó]digo|contrase(?:ñ|n)a|password|clave)\s*[:=]\s*\S+/gi, '$1')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, ' ')
      .replace(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z\d]\d\b|\b[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}\b/gi, ' ')
      .replace(/\b[A-Z\d_-]{24,}\b|\b\d{4,}\b|\d{3}[ -]\d{3}(?:[ -]\d{2,4})?/gi, ' ')
      // eslint-disable-next-line no-control-regex -- Keep hidden controls out of shareable URLs.
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, HELP_QUERY_LIMIT)
      .trimEnd()
  );
}

export function helpSearchHref(query: string, filters: HelpFilters = {}) {
  const params = new URLSearchParams();
  const clean = cleanHelpQuery(query);
  if (clean) params.set('q', clean);
  if (filters.categoria) params.set('categoria', filters.categoria);
  if (filters.audiencia) params.set('audiencia', filters.audiencia);
  if (filters.tipo) params.set('tipo', filters.tipo);
  const search = params.toString();
  return search ? HELP_ROOT + '/buscar?' + search : HELP_ROOT + '/buscar';
}
