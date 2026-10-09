export type FormPublicationPermissions = {
  canSaveDraft: boolean;
  canPublish: boolean;
  canSubmitApproval: boolean;
  canCreateVersion: boolean;
};

export function formPublicationPermissions(input: {
  workspaceType: 'personal' | 'business';
  personalOwner: boolean;
  ownsForm: boolean;
  canManageResources: boolean;
  hasApprovalWorkflow: boolean;
  canExecuteWorkflow: boolean;
  formStatus?: string;
  publishedAt?: string | null;
}): FormPublicationPermissions {
  const isDraft = !input.formStatus || (input.formStatus === 'draft' && !input.publishedAt);
  const canManage =
    input.canManageResources || (input.workspaceType === 'personal' && input.personalOwner);
  return {
    canSaveDraft: isDraft && (input.ownsForm || canManage),
    canPublish: isDraft && canManage && !input.hasApprovalWorkflow,
    canSubmitApproval:
      isDraft &&
      input.workspaceType === 'business' &&
      input.hasApprovalWorkflow &&
      input.canExecuteWorkflow &&
      (input.ownsForm || canManage),
    canCreateVersion: Boolean(input.publishedAt) && input.formStatus !== 'in_review' && canManage,
  };
}
