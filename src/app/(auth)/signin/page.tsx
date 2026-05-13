'use client';
import { signIn } from 'next-auth/react';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: 'This email is already registered with a different sign-in method. Try magic link instead.',
  OAuthCallback: 'Google sign-in failed. Check that your OAuth redirect URI is configured correctly in Google Cloud Console.',
  OAuthCreateAccount: 'Could not create account. Please try again.',
  Callback: 'Authentication callback error. Please try again.',
  Default: 'Something went wrong. Please try again.',
};

function SignInForm() {
  const params = useSearchParams();
  const errorCode = params.get('error');
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null;

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await signIn('email', { email, redirect: false, callbackUrl: '/' });
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2">My Workspace</h1>
        <p className="text-muted text-sm mb-8">
          Your personal hub for work, side gigs, and life.
        </p>

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
            {errorMessage}
          </div>
        )}

        {sent ? (
          <div className="rounded-lg border border-border p-4 text-sm">
            Check your inbox for a magic link.
          </div>
        ) : (
          <>
            {/* Google */}
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl: '/' })}
              className="w-full flex items-center justify-center gap-3 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-bg transition-colors font-medium text-sm mb-4"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Email magic link */}
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
