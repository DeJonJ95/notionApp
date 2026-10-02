'use client';

import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { api, type EventSummary } from './types';

const field = 'bg-bg text-text border border-border rounded px-2 py-1.5 text-sm';
type Db = { id: string; name: string; rows: number };
type Result = { people: number; guests: number; invited?: number };

function FromDatabase({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [dbs, setDbs] = useState<Db[]>([]);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [dbId, setDbId] = useState('');
  const [nextId, setNextId] = useState('');

  useEffect(() => {
    api<Db[]>(`/api/events/${eventId}/from-database`).then(setDbs).catch(() => {});
    api<EventSummary[]>('/api/events').then((e) => setEvents(e.filter((x) => x.id !== eventId))).catch(() => {});
  }, [eventId]);

  if (dbs.length === 0) return null;
  const run = async () => {
    try {
      const r = await api<Result>(`/api/events/${eventId}/from-database`, 'POST', { databaseId: dbId, nextEventId: nextId || undefined });
      toast.success(`${r.guests} guests copied, ${r.people} new people${r.invited ? `, ${r.invited} invites moved` : ''}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Copy failed');
    }
  };

  return (
    <div className="space-y-2 pt-3 border-t border-border">
      <p className="text-sm text-text">Or copy a Guest List database into this event.</p>
      <div className="flex flex-wrap gap-2">
        <select value={dbId} onChange={(e) => setDbId(e.target.value)} className={field} aria-label="Guest List database">
          <option value="">Choose database</option>
          {dbs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.rows})</option>)}
        </select>
        <select value={nextId} onChange={(e) => setNextId(e.target.value)} className={field} aria-label="Event for the Sunday Invite column">
          <option value="">Sunday Invite column: skip</option>
          {events.map((e) => <option key={e.id} value={e.id}>Sunday Invite → {e.name}</option>)}
        </select>
        <button onClick={run} disabled={!dbId} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-50">Copy</button>
      </div>
    </div>
  );
}

export function ImportPanel({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('text');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<Result>(`/api/events/${eventId}/guests`, 'POST', { text, source });
      toast.success(`${r.guests} guests imported, ${r.people} new people`);
      setText('');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text">Add guests</h2>
      <p className="text-sm text-text">
        Upload the Partiful guest CSV, or paste names one per line (&quot;Name, phone or @handle&quot; works too). People you&apos;ve seen before are matched, not duplicated.
      </p>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} className="text-sm text-text" />
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className={`w-full font-mono ${field}`} placeholder={'Jordan H, @jordanh\nMello'} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-text">
          Pasted names were{' '}
          <select value={source} onChange={(e) => setSource(e.target.value)} className={field}>
            {[['text', 'texted'], ['dm', 'DMed'], ['walk-in', 'walk-ins']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <button onClick={submit} disabled={busy || !text.trim()} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-50">
          {busy ? 'Importing...' : 'Import'}
        </button>
      </div>
      <FromDatabase eventId={eventId} onDone={onDone} />
    </section>
  );
}
