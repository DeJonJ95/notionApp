'use client';
import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    console.log('Providers component mounted on client');
    console.log('Window location:', window.location.href);
  }, []);
  return <SessionProvider>{children}</SessionProvider>;
}
