'use client';

import { useMemo, useState } from 'react';
import { trends } from '@/lib/events/metrics';
import { peopleFacts, summarize, type PersonFacts } from '@/lib/events/peopleMetrics';
import { toast } from '@/components/ui/feedback';
import { pct, Stat, StackedColumns } from './charts';
import { api, fmtDate } from './types';
import type { MetricsData } from './MetricsView';

type Person = MetricsData['people'][number];

function TrendTable({ rows }: { rows: ReturnType<typeof trends> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <th className="py-1.5 font-medium">Event</th>
          <th className="py-1.5 text-right font-medium">Came</th>
          <th className="py-1.5 text-right font-medium">New</th>
          <th className="py-1.5 text-right font-medium">Returning</th>
          <th className="py-1.5 text-right font-medium">Came back next time</th>
          <th className="py-1.5 text-right font-medium">Community</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border text-text">
        {rows.map((t) => (
          <tr key={t.event.id}>
            <td className="py-1.5">{t.event.name} <span className="text-xs text-muted">{fmtDate(t.event.date)}</span></td>
            <td className="text-right tabular-nums">{t.came}</td>
            <td className="text-right tabular-nums">{t.newcomers}</td>
            <td className="text-right tabular-nums">{t.returning}</td>
            <td className="text-right tabular-nums">{pct(t.retained)}</td>
            <td className="text-right tabular-nums">{t.community}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ListProps = { title: string; why: string; facts: PersonFacts[]; people: Map<string, Person>; meta: (f: PersonFacts) => string; target: string; onInvited: () => void };

function ActionList({ title, why, facts, people, meta, target, onInvited }: ListProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const invite = async () => {
    try {
      const r = await api<{ added: number }>(`/api/events/${target}/invites`, 'POST', { personIds: Array.from(picked) });
      toast.success(`Added ${r.added} to the invite list`);
      setPicked(new Set());
      onInvited();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add');
    }
  };
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-text">{title} <span className="tabular-nums">({facts.length})</span></h3>
      <p className="text-sm text-text">{why}</p>
      {facts.length > 0 && (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto border-y border-border">
          {facts.map((f) => (
            <li key={f.id}>
              <label className="flex items-center gap-2 py-1.5 text-sm text-text">
                {target && <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />}
                <span className="flex-1 truncate">{people.get(f.id)?.name ?? 'Unknown'}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-muted">{meta(f)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {target && picked.size > 0 && (
        <button onClick={invite} className="rounded bg-accent px-3 py-1.5 text-sm text-white">Add {picked.size} to invite list</button>
      )}
    </section>
  );
}

export function MetricsTrends({ data, onInvited }: { data: MetricsData; onInvited: () => void }) {
  const t = useMemo(() => trends(data.events, data.rows), [data]);
  const s = useMemo(() => summarize(peopleFacts(data.events, data.rows)), [data]);
  const people = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const upcoming = data.events.filter((e) => new Date(e.date) >= new Date());
  const [target, setTarget] = useState(upcoming[0]?.id ?? '');
  const lists = { people, target, onInvited };

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-text">Across events</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Community" value={t.at(-1)?.community ?? 0} note="people who've come at least once" />
          <Stat label="Came 2+ times" value={s.regulars2} />
          <Stat label="Came 3+ times" value={s.regulars3} />
          <Stat label="Came back" value={pct(t.at(-2)?.retained ?? null)} note={t.length > 1 ? `of ${t.at(-2)!.event.name} to the next` : 'needs two past events'} />
        </dl>
        {t.length > 0 && <StackedColumns data={t.map((x) => ({ label: x.event.name, a: x.returning, b: x.newcomers }))} aLabel="Returning" bLabel="New" />}
        {t.length > 0 && <TrendTable rows={t} />}
      </section>
      <section className="space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-text">Who needs a nudge</h2>
          {upcoming.length > 0 && (
            <label className="text-sm text-text">Invite to{' '}
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-border bg-bg px-2 py-1">
                {upcoming.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          <ActionList {...lists} title="Lapsed regulars" why="Came twice or more but missed the last event. Worth a personal text." facts={s.lapsed} meta={(f) => `came ${f.attended}×`} />
          <ActionList {...lists} title="Repeat no-shows" why="Said going twice or more and didn't come." facts={s.noShowers} meta={(f) => `${f.noShows} no-shows`} />
          <ActionList {...lists} title="Connectors" why="Bring the most people who actually show up." facts={s.connectors} meta={(f) => `${f.broughtCame} of ${f.brought} +1s came`} />
        </div>
      </section>
    </div>
  );
}
