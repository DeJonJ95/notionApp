'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadView } from '@/lib/assist/types';

export type AssistTodo = { pageId: string; date: string; text: string; linkedRowId: string | null };

function errorOf(d: unknown): string | null {
  return d && typeof d === 'object' && 'error' in d && typeof d.error === 'string' ? d.error : null;
}

async function call(url: string, init?: RequestInit): Promise<ThreadView | null> {
  const r = await fetch(url, init);
  const d: unknown = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorOf(d) ?? (r.status === 504 ? 'The assistant timed out. Try again.' : 'Something went wrong'));
  return d && typeof d === 'object' && 'thread' in d ? (d.thread as ThreadView | null) : null;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** One to-do's assistant thread: loads it, or starts one when there is none yet. */
export function useAssist(todo: AssistTodo) {
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [busy, setBusy] = useState<'' | 'thinking' | 'applying'>('');
  const [error, setError] = useState('');
  const started = useRef(false);

  const run = useCallback(async (kind: 'thinking' | 'applying', work: () => Promise<ThreadView | null>) => {
    setError(''); setBusy(kind);
    try {
      const next = await work();
      if (next) setThread(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy('');
    }
  }, []);

  const turn = useCallback((message?: string) => run('thinking', () =>
    call('/api/assist', post({ pageId: todo.pageId, todo: todo.text, today: todo.date, linkedRowId: todo.linkedRowId, message })),
  ), [run, todo]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run('thinking', async () => {
      const q = new URLSearchParams({ pageId: todo.pageId, todo: todo.text });
      const existing = await call(`/api/assist?${q}`);
      return existing ?? call('/api/assist', post({ pageId: todo.pageId, todo: todo.text, today: todo.date, linkedRowId: todo.linkedRowId }));
    });
  }, [run, todo]);

  const restart = () => run('thinking', async () => {
    if (thread) await fetch(`/api/assist/${thread.id}`, { method: 'DELETE' });
    return call('/api/assist', post({ pageId: todo.pageId, todo: todo.text, today: todo.date, linkedRowId: todo.linkedRowId }));
  });

  const apply = (accept: number[]) => thread && run('applying', () => call(`/api/assist/${thread.id}/apply`, post({ accept })));
  const undo = () => thread && run('applying', () => call(`/api/assist/${thread.id}/undo`, post({})));

  return { thread, busy, error, send: turn, restart, apply, undo };
}

const STAGES = ['Reading the to-do…', 'Looking through your workspace…', 'Writing…', 'Still writing. The model is slow right now…'];

/** A loading line that moves on as the wait grows, so a long call never looks stuck. */
export function useStage(active: boolean): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const timers = [2500, 6000, 20000].map((ms, n) => setTimeout(() => setI(n + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [active]);
  return STAGES[i];
}
