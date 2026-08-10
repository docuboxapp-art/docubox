import { redirect } from 'next/navigation';

export default async function ShortPublicVerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/verificar-documento/${encodeURIComponent(token)}`);
}
