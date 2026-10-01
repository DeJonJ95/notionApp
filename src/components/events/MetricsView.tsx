'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { arrivals, eventFunnel, rsvpTiming, textEffect, TIMING_BUCKETS, type MEvent, type MRow } from '@/lib/events/metrics';
import { Columns, FunnelBars, pct, Stat } from './charts';
import { MetricsTrends } from './MetricsTrends';
import { api, fmtDate } from './types';

export type MetricsData = { events: MEvent[]; rows: MRow[]; people: { id: string; name: string; contact: string | null }[] };

function TextEffect({ rows }: { rows: MRow[] }) {
  const t = textEffect(rows);
  if (t.texted.n === 0) return <p className="text-sm text-text">No personal texts recorded for this event yet. Mark them in Send invites to compare.</p>;
  const rate = (g: { n: number; yes: number }) => (g.n ? g.yes / g.n : null);
  return (
    <dl className="grid grid-cols-2 gap-4">
      <Stat label="Texted personally" value={pct(rate(t.texted))} note={`${t.texted.yes} of ${t.texted.n} said yes after the text`} />
      <Stat label="Partiful invite only" value={pct(rate(t.partifulOnly))} note={`${t.partifulOnly.yes} of ${t.partifulOnly.n} said yes`} />
    </dl>
  );
}

function EventSection({ data, eventId }: { data: MetricsData; eventId: string }) {
  const event = data.events.find((e) => e.id === eventId)!;
  const rows = data.rows.filter((r) => r.eventId === eventId);
  const cameBefore = useMemo(() => {
    const earlier = new Set(data.events.filter((e) => e.date < event.date).map((e) => e.id));
    return new Set(data.rows.filter((r) => r.attended && earlier.has(r.eventId)).map((r) => r.personId));
  }, [data, event.date]);
  const f = eventFunnel(rows, cameBefore);
  const timing = rsvpTiming(rows, event.date);
  const arrive = arrivals(rows);

  return (
    <section className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">
        <Stat label="Going" value={f.going} note={f.maybe ? `+${f.maybe} maybe` : undefined} />
        <Stat label="Came" value={f.came} note={f.walkIns ? `${f.walkIns} without an RSVP` : undefined} />
        <Stat label="Show rate" value={pct(f.showRate)} note="of going who came" />
        <Stat label="New faces" value={f.newcomers} note={`${f.returning} returning`} />
      </dl>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="font-semibold text-text">From invite to the door</h3>
          <FunnelBars steps={[
            { label: 'On the list', value: f.listed },
            { label: 'Texted', value: f.texted },
            { label: 'Said going', value: f.going },
            { label: 'Came', value: f.came },
          ]} />
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold text-text">Do personal texts work?</h3>
          <TextEffect rows={rows} />
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold text-text">When people RSVP&apos;d</h3>
          <Columns data={TIMING_BUCKETS.map((label, i) => ({ label, value: timing[i], detail: `${label}: ${timing[i]} RSVPs` }))} />
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold text-text">When people arrived</h3>
          {arrive.length ? <Columns data={arrive.map((a) => ({ label: a.label, value: a.count, detail: `${a.label}: ${a.count} check-ins` }))} />
            : <p className="text-sm text-text">Arrival times come from door check-ins, so this fills in once the event runs.</p>}
        </div>
      </div>
    </section>
  );
}

export function MetricsView() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [eventId, setEventId] = useState('');
  const load = () => api<MetricsData>('/api/events/metrics').then((d) => {
    setData(d);
    setEventId((cur) => cur || [...d.events].reverse().find((e) => d.rows.some((r) => r.eventId === e.id))?.id || '');
  });
  useEffect(() => { load(); }, []);

  if (!data) return null;
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-6">
      <div className="space-y-1">
        <Link href="/events" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} /> Events</Link>
        <h1 className="text-2xl font-semibold text-text">Metrics</h1>
      </div>
      {data.events.length === 0 ? <p className="text-text">Add an event and import its guests to see metrics.</p> : (
        <>
          <div className="space-y-4">
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="rounded border border-border bg-bg px-2 py-1.5 text-lg font-semibold text-text" aria-label="Event">
              {[...data.events].reverse().map((e) => <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.date)}</option>)}
            </select>
            {eventId && <EventSection data={data} eventId={eventId} />}
          </div>
          <MetricsTrends data={data} onInvited={load} />
        </>
      )}
    </div>
  );
}
