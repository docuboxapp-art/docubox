type CaseDeliveryStore = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
import { deliverCaseInvitations, type InvitationClaim } from './invitations.ts';
/** Shared by Next and the scheduled Edge worker; no session or framework imports. */
export async function dispatchCaseMail(
  service: CaseDeliveryStore,
  caseId: string,
  actorId: string,
  config: Parameters<typeof deliverCaseInvitations>[1]
) {
  for (const code of [false, true]) {
    const prefix = code ? 'case_invitation_code' : 'case_invitation';
    await deliverCaseInvitations(
      {
        async claim() {
          const r = await service.rpc(`${prefix}_claim`, { p_case: caseId, p_actor: actorId });
          if (r.error) throw r.error;
          return (r.data || []) as InvitationClaim[];
        },
        async savePayload(id, claim, encrypted) {
          const r = await service.rpc(`${prefix}_payload`, {
            p_id: id,
            p_claim: claim,
            p_ciphertext: encrypted,
          });
          if (r.error) throw r.error;
          return String(r.data);
        },
        async finish(id, claim, status, provider, code) {
          const r = await service.rpc(`${prefix}_finish`, {
            p_id: id,
            p_claim: claim,
            p_status: status,
            p_provider: provider,
            p_code: code,
          });
          if (r.error) throw r.error;
          return r.data === true;
        },
      },
      { ...config, budgetMs: config.budgetMs ?? 25000 }
    );
  }
}
