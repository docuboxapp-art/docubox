'use client';

import { Toaster } from 'sonner';

export default function AppToaster() {
  return <Toaster position="bottom-center" closeButton duration={5000} visibleToasts={3} />;
}
