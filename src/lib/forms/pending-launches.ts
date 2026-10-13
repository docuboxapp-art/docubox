export type FormLaunchSummary = {
  id: string;
  template_id: string;
  access_mode?: 'private' | 'public' | null;
  recipient_name: string | null;
  recipient_email: string;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
};

export type PublicFormInviteSummary = {
  form_id: string;
  recipient_name: string | null;
  recipient_email: string;
  invited_at: string;
};

export type FormResponseSummary = {
  template_id: string;
  token_id: string;
  respondent_email: string | null;
  submitted_at: string;
};

const recipientKey = (formId: string, email: string) =>
  `${formId}:${email.trim().toLowerCase()}`;

export function summarizeFormLaunches(
  launches: FormLaunchSummary[],
  publicInvitees: PublicFormInviteSummary[],
  responses: FormResponseSummary[],
  unsentTokenIds: Set<string>,
  now: number
) {
  const answeredTokenIds = new Set(responses.map((response) => response.token_id));
  const latestResponseByRecipient = new Map<string, number>();
  for (const response of responses) {
    if (!response.respondent_email) continue;
    const key = recipientKey(response.template_id, response.respondent_email);
    const timestamp = Date.parse(response.submitted_at);
    if (Number.isFinite(timestamp))
      latestResponseByRecipient.set(key, Math.max(timestamp, latestResponseByRecipient.get(key) || 0));
  }

  const tokenLaunches = launches.filter((launch) => {
    const created = Date.parse(launch.created_at);
    return !unsentTokenIds.has(launch.id) && !launch.used_at && !answeredTokenIds.has(launch.id) &&
      (latestResponseByRecipient.get(recipientKey(launch.template_id, launch.recipient_email)) || 0) < created &&
      (!launch.expires_at || Date.parse(launch.expires_at) > now);
  });

  const inviteesWithoutToken = publicInvitees.filter((invitee) => {
    const invited = Date.parse(invitee.invited_at);
    return !launches.some((launch) =>
      launch.access_mode === 'public' && launch.template_id === invitee.form_id &&
      recipientKey(launch.template_id, launch.recipient_email) === recipientKey(invitee.form_id, invitee.recipient_email) &&
      Date.parse(launch.created_at) >= invited
    );
  });
  const pendingPublicInvitees = inviteesWithoutToken.filter((invitee) =>
    (latestResponseByRecipient.get(recipientKey(invitee.form_id, invitee.recipient_email)) || 0) < Date.parse(invitee.invited_at)
  );

  return {
    tokenLaunches,
    pendingPublicInvitees,
    launchedCount: launches.length + inviteesWithoutToken.length,
  };
}
