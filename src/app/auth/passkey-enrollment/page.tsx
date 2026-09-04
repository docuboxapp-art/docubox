import { notFound, redirect } from 'next/navigation';
import { getCurrentPlatformAccess } from '@/lib/platform-admin/access';
import MandatoryPasskeyEnrollment from './MandatoryPasskeyEnrollment';

export const dynamic = 'force-dynamic';

export default async function PasskeyEnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { user, access } = await getCurrentPlatformAccess();
  if (!user) redirect('/login?redirect=/panel');
  if (!access) notFound();

  const requested = (await searchParams).redirect || '/panel';
  const redirectTo =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/panel';

  if (!access.passkeyRequired || access.passkeyEnrolled) {
    redirect(
      access.totpEnrolled
        ? `/login/totp-verification?redirect=${encodeURIComponent(redirectTo)}`
        : `/auth/totp-enrollment?redirect=${encodeURIComponent(redirectTo)}`
    );
  }

  return <MandatoryPasskeyEnrollment redirectTo={redirectTo} />;
}
