'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import PublicFormCodeEntry from '@/components/forms/PublicFormCodeEntry';

function Entry() {
  return <PublicFormCodeEntry formId={useParams().formId as string} />;
}

export default function PublicFormEntryPage() {
  return <Suspense fallback={null}><Entry /></Suspense>;
}
