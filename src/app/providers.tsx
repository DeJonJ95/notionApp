'use client';
import { SessionProvider } from 'next-auth/react';
import { FeedbackHost } from '@/components/ui/feedback';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <FeedbackHost />
    </SessionProvider>
  );
}
