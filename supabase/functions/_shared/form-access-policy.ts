export type FormAccessToken = {
  access_mode: string | null;
  recipient_email: string | null;
  recipient_user_id: string | null;
  liveness_verified_at: string | null;
};

export type FormAccessUser = {
  id: string;
  email?: string | null;
};

export type FormAccessDenial = 'FORBIDDEN' | 'LIVENESS_REQUIRED';

// A public form token is a short-lived bearer capability issued only after
// the separately delivered code and the mobile identity check have passed.
export function publicFormCapabilityDenial(token: FormAccessToken): FormAccessDenial | null {
  if (token.access_mode !== 'public' || !token.recipient_email || !token.recipient_user_id)
    return 'FORBIDDEN';
  const verifiedAt = Date.parse(token.liveness_verified_at || '');
  return Number.isFinite(verifiedAt) && verifiedAt <= Date.now() &&
    Date.now() - verifiedAt <= 24 * 60 * 60_000 ? null : 'LIVENESS_REQUIRED';
}

// Private links belong to the authenticated recipient. Public capabilities
// are handled separately so they never become a full account session.
export function formAccessDenial(token: FormAccessToken, user: FormAccessUser): FormAccessDenial | null {
  const recipientEmail = token.recipient_email?.trim().toLowerCase();
  const userEmail = user.email?.trim().toLowerCase();
  if (!recipientEmail || !userEmail || recipientEmail !== userEmail) return 'FORBIDDEN';

  if (token.access_mode === 'private') {
    return token.recipient_user_id && token.recipient_user_id !== user.id ? 'FORBIDDEN' : null;
  }
  if (token.access_mode === 'public') {
    if (token.recipient_user_id !== user.id) return 'FORBIDDEN';
    return token.liveness_verified_at ? null : 'LIVENESS_REQUIRED';
  }
  return 'FORBIDDEN';
}
