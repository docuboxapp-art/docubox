'use client';

import { useParams } from 'next/navigation';
import OrganizationDirectoryPerson from '../../_components/OrganizationDirectoryPerson';

export default function OrganizationDirectoryPersonPage() {
  const params = useParams<{ personId: string }>();
  return <OrganizationDirectoryPerson personId={params.personId} />;
}
