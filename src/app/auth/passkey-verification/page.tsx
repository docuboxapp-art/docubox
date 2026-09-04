import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getCurrentPlatformAccess } from '@/lib/platform-admin/access';
import {
  PLATFORM_PASSKEY_COOKIE,
  verifyPlatformPasskeyProof,
} from '@/lib/security/platform-passkey-proof';
import MandatoryPasskeyVerification from './MandatoryPasskeyVerification';

export const dynamic = 'force-dynamic';

export default async function PasskeyVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { user, access } = await getCurrentPlatformAccess();
  if (!user) redirect('/login?redirect=/panel');
  if (!access) notFound();
  if (!access.passkeyEnrolled) redirect('/auth/passkey-enrollment?redirect=/panel');

  const requested = (await searchParams).redirect || '/panel';
  const redirectTo =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/panel';
  const cookieStore = await cookies();
  if (verifyPlatformPasskeyProof(cookieStore.get(PLATFORM_PASSKEY_COOKIE)?.value, user.id)) {
    redirect(`/login/totp-verification?redirect=${encodeURIComponent(redirectTo)}`);
  }

  if (!user.email) notFound();
  return <MandatoryPasskeyVerification email={user.email} redirectTo={redirectTo} />;
}
