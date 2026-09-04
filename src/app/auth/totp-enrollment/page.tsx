import { notFound, redirect } from 'next/navigation';
import { getCurrentPlatformAccess } from '@/lib/platform-admin/access';
import MandatoryTotpEnrollment from './MandatoryTotpEnrollment';

export const dynamic = 'force-dynamic';

export default async function TotpEnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { user, access } = await getCurrentPlatformAccess();
  if (!user) redirect('/login?redirect=/panel');
  if (!access) notFound();
  if (access.passkeyRequired && !access.passkeyEnrolled) {
    redirect('/auth/passkey-enrollment?redirect=/panel');
  }
  if (access.totpEnrolled) redirect('/login/totp-verification?redirect=/panel');

  const requested = (await searchParams).redirect || '/panel';
  const redirectTo =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/panel';
  return <MandatoryTotpEnrollment redirectTo={redirectTo} />;
}
