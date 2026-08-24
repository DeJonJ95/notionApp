'use client';
import { useEffect, useState, useCallback } from 'react';
import { X, Wallet, Loader2 } from 'lucide-react';
import type { CategoryBudgetsPayload } from '@/app/api/budget/category-budgets/route';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function CategoryBudgetsModal({
  categoryOptions,
  focusCategory,
  onClose,
  onChanged,
}: {
  categoryOptions: string[];
  focusCategory?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(categoryOptions);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/budget/category-budgets')
      .then(async (r) => {
        const text = await r.text();
        let j: any = {};
        try { j = text ? JSON.parse(text) : {}; } catch {}
        if (!r.ok) { setError(j?.error ?? `Failed (HTTP ${r.status})`); return null; }
        return j as CategoryBudgetsPayload;
      })
      .then((payload) => {
        if (!payload) return;
        const next: Record<string, string> = {};
        for (const b of payload.budgets) next[b.category] = String(b.amount);
        setValues(next);
        setInitial(next);
        const merged = new Set([...categoryOptions, ...payload.categoryOptions]);
        setCategories(Array.from(merged).sort((a, b) => a.localeCompare(b)));
      })
      .finally(() => setLoading(false));
  }, [categoryOptions]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const changed = categories.filter((c) => (values[c] ?? '') !== (initial[c] ?? ''));
    if (changed.length === 0) { onClose(); return; }
    setSaving(true);
    setError('');
    try {
      for (const category of changed) {
        const raw = (values[category] ?? '').trim();
        const amount = raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(amount)) continue;
        const res = await fetch('/api/budget/category-budgets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, amount }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? `Couldn't save ${category}`);
          setSaving(false);
          return;
        }
      }
      onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const total = categories.reduce((s, c) => {
    const n = Number(values[c] ?? '');
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Wallet size={16} className="text-accent" /> Monthly budgets
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 text-xs px-3 py-2">{error}</div>
          )}
          <p className="text-xs text-muted">
            Set a monthly target per category. Leave a category blank or set it to 0 to remove its
            budget. These are the same envelope rows the database&apos;s Budget Summary view reads.
          </p>
          {loading ? (
            <div className="text-center py-6"><Loader2 size={18} className="inline animate-spin text-accent" /></div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">No categories found on the budget database.</p>
          ) : (
            categories.map((c) => (
              <label key={c} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <span className="flex-1 min-w-0 text-sm truncate">{c}</span>
                <span className="text-muted text-sm">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={values[c] ?? ''}
                  autoFocus={focusCategory === c}
                  onChange={(e) => setValues((prev) => ({ ...prev, [c]: e.target.value }))}
                  placeholder="0"
                  className="w-28 bg-bg border border-border rounded px-2 py-1.5 text-sm text-text text-right"
                />
              </label>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-3.5 border-t border-border shrink-0">
          <span className="text-xs text-muted">Total budgeted: <strong className="text-text">{fmt(total)}</strong>/mo</span>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-surface">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 disabled:opacity-60"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save budgets'}
          </button>
        </div>
      </div>
    </div>
  );
}
