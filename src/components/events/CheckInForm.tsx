'use client';

import { useEffect, useState } from 'react';

type Info = { name: string; date: string; venue: string | null; open: boolean };

const field = 'w-full px-4 py-3 bg-bg text-text border border-border rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-accent';

export function CheckInForm({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null | 'missing'>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | string>('idle');

  useEffect(() => {
    fetch(`/api/checkin/${token}`)
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then(setInfo)
      .catch(() => setInfo('missing'));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const res = await fetch(`/api/checkin/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setState(res?.ok ? 'done' : data?.error ?? 'Something went wrong. Try again.');
  };

  if (info === null) return null;
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        {info === 'missing' ? (
          <p className="text-lg text-text">This check-in link isn&apos;t valid.</p>
        ) : state === 'done' ? (
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-text">You&apos;re in.</h1>
            <p className="text-lg text-text">Welcome to {info.name}. You&apos;ll hear about the next one.</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold text-text">{info.name}</h1>
              <p className="text-base text-text">
                {new Date(info.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                {info.venue ? ` · ${info.venue}` : ''}
              </p>
            </div>
            {!info.open ? (
              <p className="text-lg text-text">Check-in isn&apos;t open right now.</p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required maxLength={120} className={field} />
                <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone number or @instagram" autoComplete="tel" maxLength={120} className={field} />
                <button type="submit" disabled={state === 'sending'} className="w-full py-3 bg-accent text-white rounded-lg text-base font-medium disabled:opacity-50">
                  {state === 'sending' ? 'Checking in...' : 'Check in'}
                </button>
                {state !== 'idle' && state !== 'sending' && <p className="text-sm text-red-500">{state}</p>}
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
