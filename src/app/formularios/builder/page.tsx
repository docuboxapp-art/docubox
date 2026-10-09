import { redirect } from 'next/navigation';

export default async function FormBuilderLegacyPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  redirect(id ? `/formularios/nuevo?id=${encodeURIComponent(id)}` : '/formularios/nuevo');
}
