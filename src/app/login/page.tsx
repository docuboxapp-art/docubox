import React, { Suspense } from 'react';
import AuthScreen from '../sign-up-login-screen/components/AuthScreen';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthScreen />
    </Suspense>
  );
}
