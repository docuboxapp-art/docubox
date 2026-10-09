'use client';

import { useParams } from 'next/navigation';
import PublicFormCodeEntry from '@/components/forms/PublicFormCodeEntry';

export default function PublicFormEntryPage() {
  return <PublicFormCodeEntry formId={useParams().formId as string} />;
}
