import { Suspense } from 'react';
import PublicFormCodeEntry from '@/components/forms/PublicFormCodeEntry';

export default function PublicFormCodePage() {
  return <Suspense fallback={null}><PublicFormCodeEntry /></Suspense>;
}
