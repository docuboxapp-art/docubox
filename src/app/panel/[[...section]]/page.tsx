import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import SuperadminShell from '@/components/platform-admin/SuperadminShell';
import { getCurrentPlatformAccess } from '@/lib/platform-admin/access';
import PlatformAdminPage from '@/components/platform-admin/PlatformAdminPage';
import { PLATFORM_MFA_COOKIE, verifyPlatformMfaProof } from '@/lib/security/platform-mfa-proof';
import {
  PLATFORM_PASSKEY_COOKIE,
  verifyPlatformPasskeyProof,
} from '@/lib/security/platform-passkey-proof';

export const dynamic = 'force-dynamic';

type PanelPageProps = { params: Promise<{ section?: string[] }> };

export default async function PanelPage(props: PanelPageProps) {
  const { user, access } = await getCurrentPlatformAccess();
  if (!user) redirect('/login?redirect=/panel');
  if (!access) notFound();
  if (access.passkeyRequired && !access.passkeyEnrolled) {
    redirect('/auth/passkey-enrollment?redirect=/panel');
  }
  if (!access.totpEnrolled) redirect('/auth/totp-enrollment?redirect=/panel');

  const cookieStore = await cookies();
  const mfaVerified = verifyPlatformMfaProof(cookieStore.get(PLATFORM_MFA_COOKIE)?.value, user, {
    requirePasskey: access.passkeyRequired,
  });
  if (!mfaVerified) {
    if (
      access.passkeyRequired &&
      !verifyPlatformPasskeyProof(cookieStore.get(PLATFORM_PASSKEY_COOKIE)?.value, user.id)
    ) {
      redirect('/auth/passkey-verification?redirect=/panel');
    }
    redirect('/login/totp-verification?redirect=/panel');
  }

  return (
    <SuperadminShell
      role={access.role}
      permissions={access.permissions}
      requiresStepUp={access.requiresStepUp}
    >
      <PlatformAdminPage {...props} />
    </SuperadminShell>
  );
}
