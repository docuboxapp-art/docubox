import IdentityPolicyBuilder from '../components/IdentityPolicyBuilder';

export default async function EditIdentityPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IdentityPolicyBuilder policyId={id} />;
}
