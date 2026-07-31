import React, { Suspense } from 'react';
import AuthScreen from './components/AuthScreen';

export default function SignUpLoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthScreen />
    </Suspense>
  );
}