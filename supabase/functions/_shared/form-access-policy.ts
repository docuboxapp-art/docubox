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

// Private links belong to the selected recipient. Public links are issued only
// after a verified account presents the code and passes the liveness check.
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
