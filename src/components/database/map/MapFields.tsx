'use client';

import { useEffect, useRef, useState } from 'react';

const fieldCls = 'w-full min-h-[40px] rounded-lg border border-border bg-bg px-3 text-sm font-normal focus:outline-none focus:ring-1 focus:ring-accent';
const FRESH = /^untitled( task| project)?$/i;

type Text = { id: string; label: string; value: string; placeholder?: string; onSave: (v: string) => void };

function useDraft(id: string, value: string) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [id, value]);
  return [draft, setDraft] as const;
}

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };

// A brand-new card arrives here focused with its placeholder name selected, so typing names it.
export function TitleField({ id, value, onSave }: { id: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useDraft(id, value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!FRESH.test(value.trim())) return;
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={blurOnEnter}
      onFocus={(e) => { if (FRESH.test(e.currentTarget.value.trim())) e.currentTarget.select(); }}
      onBlur={() => { const t = draft.trim(); if (t && t !== value) onSave(t); else setDraft(value); }}
      aria-label="Name" className="m-0 w-full bg-transparent text-2xl font-bold leading-tight rounded-md px-1 -mx-1 hover:bg-surface focus:bg-surface focus:outline-none" />
  );
}

export function TextField({ id, label, value, placeholder, onSave }: Text) {
  const [draft, setDraft] = useDraft(id, value);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={blurOnEnter}
        onBlur={() => draft !== value && onSave(draft)} placeholder={placeholder} className={fieldCls} />
    </label>
  );
}

export function DateField({ label, value, onSave }: Omit<Text, 'id' | 'placeholder'>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {label}
      <input type="date" value={value} onChange={(e) => onSave(e.target.value)} className={fieldCls} />
    </label>
  );
}
