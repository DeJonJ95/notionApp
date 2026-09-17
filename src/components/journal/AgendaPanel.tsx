'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AgendaRowActions } from './AgendaRowActions';
import type { Agenda, AgendaBucket, AgendaItem } from '@/lib/agenda';

export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useAgenda(date: string) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/agenda?date=${date}`, { cache: 'no-store' });
      if (res.ok) setAgenda((await res.json()) as Agenda);
    } catch {
      /* keep the last good agenda */
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { agenda, loading, reload };
}

const BUCKETS: { key: AgendaBucket; title: string; className: string }[] = [
  { key: 'overdue', title: 'Overdue', className: 'text-red-500' },
  { key: 'today', title: 'Due today', className: 'text-amber-500' },
  { key: 'inProgress', title: 'In progress', className: 'text-accent' },
];

function Row({ item, statusOptions, onChange }: { item: AgendaItem; statusOptions: string[]; onChange: () => void }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-bg text-sm">
      <Link href={`/page/${item.id}`} className="flex-1 min-w-0 truncate text-text hover:underline">
        {item.title || 'Untitled'}
      </Link>
      <Link
        href={`/database/${item.databaseId}`}
        title={`Open ${item.databaseName}`}
        className="text-xs text-muted shrink-0 truncate max-w-[8rem] hover:text-text hover:underline"
      >
        {item.databaseName}
      </Link>
      {item.dueDate && (
        <span className="text-xs text-muted shrink-0 tabular-nums">{item.dueDate.slice(5)}</span>
      )}
      <AgendaRowActions item={item} statusOptions={statusOptions} onChange={onChange} />
    </li>
  );
}

export function AgendaPanel({
  agenda, loading, onChange = () => {},
}: {
  agenda: Agenda | null;
  loading: boolean;
  onChange?: () => void;
}) {
  if (loading && !agenda) return <p className="text-sm text-muted">Loading…</p>;
  if (!agenda?.items.length) {
    return <p className="text-sm text-muted">Nothing overdue, due today, or in progress.</p>;
  }
  const optionsFor = (databaseId: string) =>
    agenda.databases.find((d) => d.id === databaseId)?.statusOptions ?? [];
  const groups = BUCKETS.map((b) => ({ ...b, items: agenda.items.filter((i) => i.bucket === b.key) }))
    .filter((g) => g.items.length);
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key}>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${g.className}`}>
            {g.title} · {g.items.length}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <Row key={item.id} item={item} statusOptions={optionsFor(item.databaseId)} onChange={onChange} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Dashboard section. Hidden until the user has at least one non-budget
// database, so a notes-only workspace never sees an empty "Today".
export function HomeAgenda() {
  const [date] = useState(localDate);
  const { agenda, loading, reload } = useAgenda(date);
  if (!loading && !agenda?.databases.length) return null;
  return (
    <section className="mb-12">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Today</h2>
      <AgendaPanel agenda={agenda} loading={loading} onChange={reload} />
    </section>
  );
}
