'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Plus, Users } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { api, fmtDate, type EventSummary } from './types';

const field = 'px-3 py-1.5 bg-bg text-text border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent';

function NewEventForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [venue, setVenue] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/events', 'POST', { name, date: `${date}T12:00:00`, venue: venue || undefined });
      setName('');
      setDate('');
      setVenue('');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create event');
    }
  };

  return (
    <form onSubmit={create} className="flex flex-wrap gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Event name" required className={`flex-1 min-w-[10rem] ${field}`} />
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={field} />
      <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" className={`min-w-[8rem] ${field}`} />
      <button type="submit" className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded text-sm">
        <Plus size={14} /> Add event
      </button>
    </form>
  );
}

export function EventsView() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const load = useCallback(() => {
    api<EventSummary[]>('/api/events').then(setEvents).catch(() => setEvents([]));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text">Events</h1>
        <div className="flex items-center gap-4">
          <Link href="/events/metrics" className="flex items-center gap-1.5 text-sm text-accent hover:underline">
            <BarChart3 size={14} /> Metrics
          </Link>
          <Link href="/people" className="flex items-center gap-1.5 text-sm text-accent hover:underline">
            <Users size={14} /> People
          </Link>
        </div>
      </div>
      <NewEventForm onCreated={load} />
      {events === null ? null : events.length === 0 ? (
        <p className="text-sm text-text">No events yet. Add one above, then import its guest list.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.id}`} className="flex items-baseline justify-between gap-4 py-3 hover:bg-surface px-1">
                <span className="min-w-0">
                  <span className="block font-medium text-text truncate">{e.name}</span>
                  <span className="block text-xs text-muted">{fmtDate(e.date)}{e.venue ? ` · ${e.venue}` : ''}</span>
                </span>
                <span className="text-sm text-text tabular-nums whitespace-nowrap">
                  {e.going} going · {e.attended} came
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
