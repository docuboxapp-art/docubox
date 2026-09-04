import { redirect } from 'next/navigation';

export default async function CertifiedNotificationLegacyDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/notificaciones-certificadas/${id}`);
}
