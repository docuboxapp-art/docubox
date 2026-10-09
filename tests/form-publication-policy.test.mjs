import assert from 'node:assert/strict';
import test from 'node:test';
import { formPublicationPermissions } from '../src/lib/forms/publication-policy.ts';

const personal = {
  workspaceType: 'personal',
  personalOwner: true,
  ownsForm: true,
  canManageResources: true,
  hasApprovalWorkflow: false,
  canExecuteWorkflow: false,
};
const organization = {
  workspaceType: 'business',
  personalOwner: false,
  ownsForm: true,
  canManageResources: true,
  hasApprovalWorkflow: true,
  canExecuteWorkflow: true,
};

test('personal owner can save, publish directly and version a publication', () => {
  assert.deepEqual(formPublicationPermissions(personal), {
    canSaveDraft: true,
    canPublish: true,
    canSubmitApproval: false,
    canCreateVersion: false,
  });
  assert.deepEqual(
    formPublicationPermissions({ ...personal, formStatus: 'published', publishedAt: '2026-10-03' }),
    {
      canSaveDraft: false,
      canPublish: false,
      canSubmitApproval: false,
      canCreateVersion: true,
    }
  );
});

test('organization workflow requires approval but still permits drafts and versions', () => {
  assert.deepEqual(formPublicationPermissions(organization), {
    canSaveDraft: true,
    canPublish: false,
    canSubmitApproval: true,
    canCreateVersion: false,
  });
  assert.deepEqual(
    formPublicationPermissions({
      ...organization,
      formStatus: 'published',
      publishedAt: '2026-10-03',
    }),
    {
      canSaveDraft: false,
      canPublish: false,
      canSubmitApproval: false,
      canCreateVersion: true,
    }
  );
});

test('organization without an active workflow may publish directly', () => {
  const result = formPublicationPermissions({ ...organization, hasApprovalWorkflow: false });
  assert.equal(result.canPublish, true);
  assert.equal(result.canSubmitApproval, false);
});

test('organization member without workflow execution can only save their own draft', () => {
  assert.deepEqual(
    formPublicationPermissions({
      ...organization,
      canManageResources: false,
      canExecuteWorkflow: false,
    }),
    {
      canSaveDraft: true,
      canPublish: false,
      canSubmitApproval: false,
      canCreateVersion: false,
    }
  );
});

test('a review cannot be edited, published, or versioned before a decision', () => {
  assert.deepEqual(formPublicationPermissions({ ...organization, formStatus: 'in_review' }), {
    canSaveDraft: false,
    canPublish: false,
    canSubmitApproval: false,
    canCreateVersion: false,
  });
});
