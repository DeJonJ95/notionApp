'use client';
import { SessionProvider } from 'next-auth/react';
import { FeedbackHost } from '@/components/ui/feedback';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <FeedbackHost />
      <ServiceWorkerRegistrar />
    </SessionProvider>
  );
}
