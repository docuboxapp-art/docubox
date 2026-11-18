import { redirect } from 'next/navigation';

// Preserve saved consultation links while moving the list into Mi Espacio.
export default async function ConsultCasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const previous = await searchParams;
  const params = new URLSearchParams({ pestana: 'expedientes' });
  for (const key of ['tipo', 'estado']) {
    const value = previous[key];
    if (typeof value === 'string') params.set(key, value);
  }
  redirect('/mis-documentos?' + params);
}
