'use client';
import { useEffect, useState, useRef } from 'react';
import { X, Plus, Search } from 'lucide-react';

// Lightweight cross-component cache so a relation column doesn't refetch the
// target database for every row. Keyed by databaseId. Short-lived (per page
// load) — relations are personal-scale so this is plenty.
type TargetDb = {
  id: string;
  name: string;
  pages: { id: string; title: string; properties: { property: { id: string; name: string }; value: any }[] }[];
};
const cache = new Map<string, Promise<TargetDb | null>>();

// Short TTL so a row added to the target DB shows up without a reload;
// `force` bypasses it entirely (used when the picker opens).
const TTL_MS = 12_000;
const ts = new Map<string, number>();

export function fetchTargetDb(databaseId: string, force = false): Promise<TargetDb | null> {
  const fresh = !force && cache.has(databaseId) && Date.now() - (ts.get(databaseId) ?? 0) < TTL_MS;
  if (!fresh) {
    ts.set(databaseId, Date.now());
    cache.set(
      databaseId,
      fetch(`/api/databases/${databaseId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    );
  }
  return cache.get(databaseId)!;
}
export function invalidateTargetDb(databaseId: string) {
  cache.delete(databaseId);
  ts.delete(databaseId);
}

// Aggregate a target property across the linked rows for a rollup.
export function computeRollup(
  linkedIds: string[],
  target: TargetDb | null,
  targetProp: string,
  agg: string
): string {
  if (!target) return '…';
  const rows = target.pages.filter((p) => linkedIds.includes(p.id));
  const vals = rows.map((p) => {
    if (targetProp === '__title__') return p.title;
    const pv = p.properties.find((v) => v.property.name === targetProp);
    return pv?.value;
  });
  const nums = vals.map((v) => Number(v)).filter((n) => !isNaN(n));
  switch (agg) {
    case 'count': return String(rows.length);
    case 'sum': return String(nums.reduce((s, n) => s + n, 0));
    case 'avg': return nums.length ? (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(2) : '0';
    case 'min': return nums.length ? String(Math.min(...nums)) : '—';
    case 'max': return nums.length ? String(Math.max(...nums)) : '—';
    default: return String(rows.length);
  }
}

// Read-only computed rollup value. Resolves the relation property's linked
// ids on the same row, then aggregates the target property across them.
export function RollupCell({
  linkedIds,
  targetDatabaseId,
  targetProp,
  agg,
}: {
  linkedIds: string[];
  targetDatabaseId: string;
  targetProp: string;
  agg: string;
}) {
  const [target, setTarget] = useState<TargetDb | null>(null);
  useEffect(() => {
    let alive = true;
    if (targetDatabaseId) fetchTargetDb(targetDatabaseId).then((t) => { if (alive) setTarget(t); });
    return () => { alive = false; };
  }, [targetDatabaseId]);
  if (!targetDatabaseId) return <span className="text-xs text-muted">—</span>;
  return (
    <span className="text-sm text-text font-medium">
      {computeRollup(linkedIds, target, targetProp, agg)}
    </span>
  );
}

interface Props {
  value: string[];                // linked page ids
  targetDatabaseId: string;
  onChange: (ids: string[]) => void;
}

export function RelationCell({ value, targetDatabaseId, onChange }: Props) {
  const [target, setTarget] = useState<TargetDb | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ids = Array.isArray(value) ? value : [];

  useEffect(() => {
    let alive = true;
    if (targetDatabaseId) fetchTargetDb(targetDatabaseId).then((t) => { if (alive) setTarget(t); });
    return () => { alive = false; };
  }, [targetDatabaseId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!targetDatabaseId) {
    return <span className="text-xs text-muted">No target DB set</span>;
  }

  const titleOf = (id: string) =>
    target?.pages.find((p) => p.id === id)?.title ?? '…';

  const candidates = (target?.pages ?? [])
    .filter((p) => !ids.includes(p.id))
    .filter((p) => !q || (p.title ?? '').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 20);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {ids.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 text-xs bg-accent/15 text-accent rounded px-1.5 py-0.5"
          >
            {titleOf(id)}
            <button
              onClick={() => onChange(ids.filter((x) => x !== id))}
              className="hover:text-red-500"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-text border border-border rounded px-1.5 py-0.5"
        >
          <Plus size={11} /> link
        </button>
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-56 rounded-lg border border-border bg-surface shadow-xl">
          <div className="relative p-1.5 border-b border-border">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${target?.name ?? 'pages'}…`}
              className="w-full pl-7 pr-2 py-1 bg-bg border border-border rounded text-xs text-text focus:outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {candidates.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">No matches.</div>
            ) : (
              candidates.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onChange([...ids, p.id]); setQ(''); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-bg truncate"
                >
                  {p.title || 'Untitled'}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
