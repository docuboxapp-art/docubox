'use client';

import { useParams } from 'next/navigation';
import OrganizationMemberDetail from '../../_components/OrganizationMemberDetail';

export default function OrganizationMemberDetailPage() {
  const params = useParams<{ memberId: string }>();
  return <OrganizationMemberDetail memberId={params.memberId} />;
}
