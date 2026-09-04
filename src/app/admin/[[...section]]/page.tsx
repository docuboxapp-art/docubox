import { redirect } from 'next/navigation';

type AdminPageProps = { params: Promise<{ section?: string[] }> };

export default async function LegacyAdminRedirect({ params }: AdminPageProps) {
  const { section = [] } = await params;
  const suffix = section.length > 0 ? `/${section.join('/')}` : '';
  redirect(`/panel${suffix}`);
}
