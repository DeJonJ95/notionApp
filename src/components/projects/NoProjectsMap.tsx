'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@/components/ui/feedback';

export function NoProjectsMap() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const workspaces: { id: string; name: string }[] = await fetch('/api/workspaces').then((r) => r.json());
      const home = workspaces.find((w) => !/journal/i.test(w.name)) ?? workspaces[0];
      const res = await fetch('/api/databases/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'projects-map', workspaceId: home.id }),
      });
      const { databaseId } = await res.json();
      router.push(`/database/${databaseId}`);
    } catch {
      toast.error('Couldn’t create the Projects map.');
      setBusy(false);
    }
  };
  return (
    <div className="max-w-xl mx-auto px-6 py-16 flex flex-col gap-4">
      <h1 className="text-3xl font-bold m-0">Projects</h1>
      <p className="m-0">Every project on one map, wired by what each one waits on. You don’t have a Projects map yet.</p>
      <button type="button" onClick={create} disabled={busy} className="self-start min-h-[44px] px-5 rounded-lg bg-accent text-white font-semibold disabled:opacity-50">
        {busy ? 'Creating…' : 'Create Projects map'}
      </button>
    </div>
  );
}
