import { redirect } from 'next/navigation';

type PageProps = { params: Promise<{ section?: string[] }> };

export default async function LegacySuperadminRedirect({ params }: PageProps) {
  const { section = [] } = await params;
  const suffix = section.length > 0 ? `/${section.join('/')}` : '';
  redirect(`/panel${suffix}`);
}
