'use client';
import { useEffect, useState, useCallback } from 'react';
import { X, Plus, Trash2, Edit3, RefreshCw, Loader2 } from 'lucide-react';

const CATEGORIES = [
  'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
  'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
  'Subscriptions', 'Investments', 'Debt', 'Gifts & Donations',
  'Emergency Fund', 'Other',
];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month (1st & 15th-ish)',
  monthly: 'Monthly',
};

export type Rule = {
  id: string;
  type: 'income' | 'expense';
  name: string;
  category: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  anchorDate: string;
  isActive: boolean;
};

interface Props {
  onClose: () => void;
  onChanged: () => void;
  // Optional prefill from "Make recurring" on a subscription
  prefill?: { name: string; amount: number; category: string };
}

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function RecurringRulesModal({ onClose, onChanged, prefill }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null); // 'new' for add form
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Partial<Rule> | null>(prefill ? {
    type: 'expense',
    name: prefill.name,
    amount: prefill.amount,
    category: prefill.category,
    frequency: 'monthly',
    anchorDate: isoDate(new Date()),
    isActive: true,
  } : null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/budget/recurring')
      .then((r) => (r.ok ? r.json() : []))
      .then((r) => setRules(r))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setError('');
    const payload = {
      type: editing.type ?? 'income',
      name: editing.name ?? '',
      category: editing.category ?? 'Other',
      amount: editing.amount ?? 0,
      frequency: editing.frequency ?? 'biweekly',
      anchorDate: editing.anchorDate ?? isoDate(new Date()),
    };
    setSavingId(editing.id ?? 'new');
    try {
      const url = editing.id ? `/api/budget/recurring/${editing.id}` : '/api/budget/recurring';
      const method = editing.id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Save failed');
        return;
      }
      setEditing(null);
      load();
      onChanged();
    } finally {
      setSavingId(null);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this recurring rule? Existing transactions remain.')) return;
    await fetch(`/api/budget/recurring/${id}`, { method: 'DELETE' });
    load();
    onChanged();
  };

  const toggleActive = async (rule: Rule) => {
    await fetch(`/api/budget/recurring/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <RefreshCw size={16} className="text-accent" />
            Recurring income &amp; bills
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-xs text-muted">
            Each scheduled occurrence is automatically added to your budget on its due date — paychecks
            show as income, bills as expenses. Catches up when you visit the budget page (no cron needed).
          </p>

          {/* List */}
          {loading ? (
            <div className="text-center py-6"><Loader2 size={18} className="inline animate-spin text-accent" /></div>
          ) : rules.length === 0 && !editing ? (
            <div className="text-center text-sm text-muted py-6">No rules yet. Add a paycheck or recurring bill below.</div>
          ) : (
            <div className="space-y-1.5">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 ${
                    r.isActive ? 'bg-surface' : 'bg-surface/40 opacity-60'
                  }`}
                >
                  <span className={`w-1 h-8 rounded-full ${r.type === 'income' ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted">
                      {r.type === 'income' ? '+' : '-'}${r.amount.toFixed(2)} · {FREQUENCY_LABELS[r.frequency]} · next {r.anchorDate.slice(0, 10)} · {r.category}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleActive(r)}
                    className={`text-[10px] px-2 py-0.5 rounded ${r.isActive ? 'bg-accent/15 text-accent' : 'bg-muted/15 text-muted'}`}
                    title="Toggle active"
                  >
                    {r.isActive ? 'Active' : 'Paused'}
                  </button>
                  <button onClick={() => setEditing(r)} className="p-1 rounded hover:bg-bg text-muted hover:text-text" title="Edit">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => del(r.id)} className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-500" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          {editing ? (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2.5">
              <div className="text-xs font-semibold text-accent uppercase tracking-wide">
                {editing.id ? 'Edit rule' : 'New rule'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted col-span-2">
                  Type
                  <select
                    value={editing.type ?? 'income'}
                    onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  >
                    <option value="income">Income (e.g. paycheck)</option>
                    <option value="expense">Expense (e.g. rent, subscription)</option>
                  </select>
                </label>
                <label className="text-xs text-muted col-span-2">
                  Name
                  <input
                    value={editing.name ?? ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="City of Detroit paycheck"
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  />
                </label>
                <label className="text-xs text-muted">
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    value={editing.amount ?? ''}
                    onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                    placeholder="1759.44"
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  />
                </label>
                <label className="text-xs text-muted">
                  Category
                  <select
                    value={editing.category ?? 'Other'}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Frequency
                  <select
                    value={editing.frequency ?? 'biweekly'}
                    onChange={(e) => setEditing({ ...editing, frequency: e.target.value as any })}
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="semimonthly">Twice a month</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label className="text-xs text-muted">
                  Next due date
                  <input
                    type="date"
                    value={(editing.anchorDate ?? '').slice(0, 10)}
                    onChange={(e) => setEditing({ ...editing, anchorDate: e.target.value })}
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
                  />
                </label>
              </div>
              {error && <div className="text-xs text-red-500">{error}</div>}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => { setEditing(null); setError(''); }}
                  className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={savingId !== null}
                  className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent/80 disabled:opacity-50"
                >
                  {savingId ? 'Saving…' : (editing.id ? 'Save' : 'Add rule')}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing({
                type: 'income',
                name: '',
                category: 'Other',
                amount: 0,
                frequency: 'biweekly',
                anchorDate: isoDate(new Date()),
                isActive: true,
              })}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border text-sm text-muted hover:bg-surface hover:text-text transition-colors"
            >
              <Plus size={14} /> Add a rule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
