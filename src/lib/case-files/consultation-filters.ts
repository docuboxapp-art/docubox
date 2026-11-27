import { CASE_STATUS_META } from './schema';

export function parseCaseFilters(params: URLSearchParams) {
  const status = params.get('estado') || 'all';
  const scope = params.get('vista') || 'all';
  const priority = params.get('prioridad') || '';
  const category = params.get('categoria') || '';
  const subtype = params.get('subtipo') || '';
  const responsible = params.get('responsable') || '';
  if (category.length > 160 || subtype.length > 160 || (responsible && responsible !== 'me'))
    throw new Error('Clasificación o responsable inválido.');
  const access = params.get('acceso') || '';
  const dateField: 'closed_at' | 'created_at' =
    params.get('fecha') === 'cierre' ? 'closed_at' : 'created_at';
  if (status !== 'all' && !Object.hasOwn(CASE_STATUS_META, status))
    throw new Error('Estado inválido.');
  if (!['all', 'active', 'due', 'favorites', 'mine'].includes(scope))
    throw new Error('Vista inválida.');
  if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority))
    throw new Error('Prioridad inválida.');
  if (access && !['public', 'private'].includes(access)) throw new Error('Acceso inválido.');
  const from = params.get('desde') || '',
    to = params.get('hasta') || '';
  for (const date of [from, to]) {
    const parsed = date ? new Date(`${date}T00:00:00Z`) : null;
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !parsed ||
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date)
    )
      throw new Error('Fecha inválida.');
  }
  if (from && to && from > to) throw new Error('La fecha inicial debe ser anterior a la final.');
  return {
    category,
    subtype,
    responsible,
    status,
    scope,
    priority,
    access,
    dateField,
    from,
    to,
    tag: (params.get('etiqueta') || '').slice(0, 120),
  };
}
