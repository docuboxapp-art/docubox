export const catalogDateOptions = [
  { id: 'all', name: 'Cualquier fecha' },
  { id: 'today', name: 'Hoy' },
  { id: '7d', name: 'Últimos 7 días' },
  { id: '30d', name: 'Últimos 30 días' },
  { id: 'none', name: 'Sin fecha' },
];

export const catalogFavoriteOptions = [
  { id: 'all', name: 'Todos' },
  { id: 'yes', name: 'Favoritos' },
  { id: 'no', name: 'Sin marcar como favorito' },
];

export function matchesCatalogDate(value: string | null | undefined, period: string, now: number) {
  if (period === 'all') return true;
  if (period === 'none') return !value;
  if (!value) return false;
  const from = new Date(now);
  const daysBack = period === '7d' ? 6 : period === '30d' ? 29 : 0;
  from.setDate(from.getDate() - daysBack);
  from.setHours(0, 0, 0, 0);
  const timestamp = Date.parse(value);
  return timestamp >= from.getTime() && timestamp <= now;
}

export function matchesCatalogFavorite(favorite: boolean, filter: string) {
  return filter === 'all' || favorite === (filter === 'yes');
}

export function toggleCatalogFilter(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export function catalogOptions(values: string[]) {
  return [...new Set(values)]
    .sort((a, b) => a.localeCompare(b, 'es-MX'))
    .map((name) => ({ id: name, name }));
}
