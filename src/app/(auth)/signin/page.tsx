'use client';
import { signIn } from 'next-auth/react';
import { useState, Suspense } from 'react';

function SignInForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn('email', { email, redirect: false });
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">My Workspace</h1>
        <p className="text-muted text-sm mb-8">
          Your personal hub for work, side gigs, and life.
        </p>

        {sent ? (
          <div className="rounded-lg border border-border p-4 text-sm">
            Check your inbox for a magic link.
          </div>
        ) : (
          <>
            <form onSubmit={handleEmailSignIn} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="submit"
                className="w-full px-3 py-2 rounded-lg bg-text text-bg font-medium hover:opacity-90"
              >
                Send magic link
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <SignInForm />
    </Suspense>
  );
}