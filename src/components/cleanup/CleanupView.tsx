'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { confirmDialog, toast } from '@/components/ui/feedback';
import type { Candidate, CleanupReason } from '@/lib/cleanup/candidates';
import { CleanupTable, keyOf, REASON_LABEL } from './CleanupTable';

type Scan = { candidates: Candidate[]; scanned: { pages: number; databases: number } };

const selectCls = 'min-h-[36px] rounded-lg border border-border bg-bg px-3 text-sm';

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function confirmMessage(chosen: Candidate[]): string {
  const dbs = chosen.filter((c) => c.kind === 'database');
  const pages = chosen.filter((c) => c.kind === 'page');
  const subpages = pages.filter((p) => /subpage/.test(p.detail)).length;
  const parts = [];
  if (dbs.length) parts.push(`${plural(dbs.length, 'database')} and every row in them`);
  if (pages.length) parts.push(plural(pages.length, 'note'));
  const nested = subpages ? ` ${plural(subpages, 'note')} you picked also has subpages, which go with it.` : '';
  return `This permanently deletes ${parts.join(' and ')}.${nested} It cannot be undone.`;
}

async function runPurge(chosen: Candidate[]): Promise<boolean> {
  if (!chosen.length) return false;
  const ok = await confirmDialog({ title: `Delete ${plural(chosen.length, 'item')}?`, message: confirmMessage(chosen), confirmText: 'Delete for good', danger: true });
  if (!ok) return false;
  try {
    const res = await fetch('/api/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds: chosen.filter((c) => c.kind === 'page').map((c) => c.id), databaseIds: chosen.filter((c) => c.kind === 'database').map((c) => c.id) }),
    });
    if (!res.ok) throw new Error();
    const d = await res.json();
    toast.success(`Deleted ${plural(d.databases, 'database')} and ${plural(d.pages, 'note')}.`);
    window.dispatchEvent(new Event('kove:refresh-tree'));
    return true;
  } catch {
    toast.error('Cleanup failed. Nothing was reported deleted.');
    return false;
  }
}

export function CleanupView() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [reason, setReason] = useState<CleanupReason | 'all'>('all');
  const [workspace, setWorkspace] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/cleanup', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: Scan) => { setScan(d); setSelected(new Set()); })
      .catch(() => toast.error('Couldn’t scan for cleanup.'));
  }, []);
  useEffect(load, [load]);

  const all = scan?.candidates ?? [];
  const workspaces = useMemo(() => Array.from(new Set(all.map((c) => c.workspace))).sort(), [all]);
  const rows = useMemo(
    () => all.filter((c) => (reason === 'all' || c.reasons.includes(reason)) && (workspace === 'all' || c.workspace === workspace)),
    [all, reason, workspace],
  );
  const counts = useMemo(() => {
    const out: Partial<Record<CleanupReason, number>> = {};
    for (const c of all) for (const r of c.reasons) out[r] = (out[r] ?? 0) + 1;
    return out;
  }, [all]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const toggleAll = () => setSelected((s) => {
    const keys = rows.map(keyOf);
    const allOn = keys.every((k) => s.has(k));
    const n = new Set(s);
    keys.forEach((k) => (allOn ? n.delete(k) : n.add(k)));
    return n;
  });

  const purge = async () => {
    setBusy(true);
    if (await runPurge(all.filter((c) => selected.has(keyOf(c))))) load();
    setBusy(false);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold m-0">Cleanup</h1>
        <p className="m-0 text-sm">
          {scan ? `Scanned ${plural(scan.scanned.pages, 'note')} and ${plural(scan.scanned.databases, 'database')}. ${plural(all.length, 'item')} could go.` : 'Scanning…'}
          {' '}Journal entries are never flagged just for being old.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={reason} onChange={(e) => setReason(e.target.value as CleanupReason | 'all')} className={selectCls} aria-label="Filter by reason">
          <option value="all">Every reason ({all.length})</option>
          {(Object.keys(REASON_LABEL) as CleanupReason[]).map((r) => <option key={r} value={r}>{REASON_LABEL[r]} ({counts[r] ?? 0})</option>)}
        </select>
        <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} className={selectCls} aria-label="Filter by workspace">
          <option value="all">Every workspace</option>
          {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" onClick={purge} disabled={!selected.size || busy}
          className="min-h-[36px] px-4 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-40">
          {busy ? 'Deleting…' : `Delete ${selected.size || ''} selected`.replace('  ', ' ')}
        </button>
      </div>
      {scan && rows.length === 0 ? <p className="text-sm">Nothing matches these filters.</p> : <CleanupTable rows={rows} selected={selected} toggle={toggle} toggleAll={toggleAll} />}
    </div>
  );
}
