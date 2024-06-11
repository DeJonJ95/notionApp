'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = await signIn('email', {
      email,
      redirect: false,
      callbackUrl: window.location.origin,
    });

    if (result?.error) {
      setError(result.error);
      return;
    }

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

            {error ? (
              <div className="mt-4 rounded-lg border border-red-400 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <button
              onClick={() => signIn('google')}
              className="w-full px-3 py-2 rounded-lg border border-border hover:bg-surface"
            >
              Continue with Google
            </button>
          </>
        )}
      </div>
    </div>
  );
}
