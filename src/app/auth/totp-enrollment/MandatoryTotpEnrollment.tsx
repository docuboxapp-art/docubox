'use client';

import TotpSetupModal from '@/components/totp/TotpSetupModal';

export default function MandatoryTotpEnrollment({ redirectTo }: { redirectTo: string }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <TotpSetupModal
        mandatory
        requiredAuthenticator="google"
        onSuccess={() => {
          window.location.href = redirectTo;
        }}
      />
    </div>
  );
}
