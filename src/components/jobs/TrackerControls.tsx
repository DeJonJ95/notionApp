'use client';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ALL_STATUSES, STATUS_COLORS, statusLabel } from '@/lib/jobs/status';
import type { Application, AppEvent } from './types';

const digits = (v: string) => v.replace(/\D/g, '');
const asNumber = (v: string) => (v ? Number(v) : null);

export function TrackerControls({ app, onChanged }: { app: Application; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(app.notes ?? '');
  const [field, setField] = useState(app.field ?? '');
  const [compMin, setCompMin] = useState(app.compOfferMin?.toString() ?? '');
  const [compMax, setCompMax] = useState(app.compOfferMax?.toString() ?? '');

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    await fetch(`/api/applications/${app.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
    setSaving(false);
    onChanged();
  };

  const saveComp = (key: 'compOfferMin' | 'compOfferMax', value: string) => {
    if (asNumber(value) !== app[key]) patch({ [key]: asNumber(value) });
  };

  return (
    <div className="border-t border-border pt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={app.status}
          onChange={(e) => patch({ status: e.target.value })}
          className={`px-2 py-1 rounded-full text-xs ${STATUS_COLORS[app.status as keyof typeof STATUS_COLORS] ?? ''}`}
        >
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
        <input
          value={field}
          onChange={(e) => setField(e.target.value)}
          onBlur={() => field !== (app.field ?? '') && patch({ field: field || null })}
          placeholder="Field"
          className="px-2 py-1 rounded border border-border bg-bg text-xs w-28"
        />
        <div className="flex items-center gap-1 text-xs">
          <span>Offer $</span>
          <input value={compMin} onChange={(e) => setCompMin(digits(e.target.value))} onBlur={() => saveComp('compOfferMin', compMin)} placeholder="min" className="px-2 py-1 rounded border border-border bg-bg w-20" />
          <span>to</span>
          <input value={compMax} onChange={(e) => setCompMax(digits(e.target.value))} onBlur={() => saveComp('compOfferMax', compMax)} placeholder="max" className="px-2 py-1 rounded border border-border bg-bg w-20" />
        </div>
        {saving && <Loader2 size={12} className="animate-spin text-muted" />}
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (app.notes ?? '') && patch({ notes: notes || null })}
        placeholder="Notes (recruiter name, next step, interview feedback…)"
        rows={2}
        className="w-full px-2 py-1.5 rounded border border-border bg-bg text-sm"
      />

      <Timeline events={app.events} />
    </div>
  );
}

function Timeline({ events }: { events: AppEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="text-xs space-y-0.5">
      {events.map((ev) => (
        <div key={ev.id} className="flex gap-2">
          <span className="shrink-0 text-muted">{new Date(ev.createdAt).toLocaleDateString()}</span>
          <span>
            {ev.fromStatus ? `${statusLabel(ev.fromStatus)} → ` : ''}{statusLabel(ev.toStatus)}
            {ev.note ? ` · ${ev.note}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
