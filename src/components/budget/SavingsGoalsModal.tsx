'use client';
import { useEffect, useState, useCallback } from 'react';
import { X, Plus, Trash2, Target, Loader2 } from 'lucide-react';
import { confirmDialog, promptDialog } from '@/components/ui/feedback';

type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function SavingsGoalsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [current, setCurrent] = useState('');
  const [deadline, setDeadline] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/budget/goals')
      .then(async (r) => {
        const text = await r.text();
        let j: any = [];
        try { j = text ? JSON.parse(text) : []; } catch {}
        if (!r.ok) { setError(j?.error ?? `Failed (HTTP ${r.status})`); return []; }
        return Array.isArray(j) ? j : [];
      })
      .then(setGoals)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim() || !Number(target)) return;
    const res = await fetch('/api/budget/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        targetAmount: Number(target),
        currentAmount: Number(current) || 0,
        deadline: deadline || null,
      }),
    });
    if (res.ok) {
      setAdding(false); setName(''); setTarget(''); setCurrent(''); setDeadline('');
      load(); onChanged();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? 'Failed to create goal');
    }
  };

  const adjust = async (g: Goal, delta: number) => {
    const next = Math.max(0, g.currentAmount + delta);
    await fetch(`/api/budget/goals/${g.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentAmount: next }),
    });
    load(); onChanged();
  };

  const del = async (id: string) => {
    if (!(await confirmDialog({
      title: 'Delete goal?', message: 'This removes the savings goal. This cannot be undone.',
      confirmText: 'Delete', danger: true,
    }))) return;
    await fetch(`/api/budget/goals/${id}`, { method: 'DELETE' });
    load(); onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Target size={16} className="text-accent" /> Savings goals
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 text-xs px-3 py-2">{error}</div>
          )}
          {loading ? (
            <div className="text-center py-6"><Loader2 size={18} className="inline animate-spin text-accent" /></div>
          ) : goals.length === 0 && !adding ? (
            <p className="text-sm text-muted text-center py-6">No goals yet.</p>
          ) : (
            goals.map((g) => {
              const pct = g.targetAmount > 0 ? Math.min((g.currentAmount / g.targetAmount) * 100, 100) : 0;
              const done = g.currentAmount >= g.targetAmount;
              // On-track check: linear pace vs elapsed time toward deadline
              let pace: string | null = null;
              if (g.deadline) {
                const created = new Date();
                const due = new Date(g.deadline);
                const now = Date.now();
                const totalMs = due.getTime() - created.getTime();
                if (due.getTime() > now) {
                  const needRate = g.targetAmount / Math.max(1, (due.getTime() - now) / (1000 * 60 * 60 * 24 * 30));
                  pace = `~${fmt(needRate)}/mo to hit by ${due.toLocaleDateString()}`;
                } else if (!done) {
                  pace = `past deadline (${due.toLocaleDateString()})`;
                }
              }
              return (
                <div key={g.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{g.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${done ? 'text-green-600' : 'text-muted'}`}>
                        {fmt(g.currentAmount)} / {fmt(g.targetAmount)}
                      </span>
                      <button onClick={() => del(g.id)} className="text-muted hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="h-2 bg-bg rounded-full overflow-hidden border border-border/50">
                    <div className={`h-full rounded-full ${done ? 'bg-green-500' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-muted">
                      {done ? '🎉 Reached!' : pace ?? `${pct.toFixed(0)}% there`}
                    </span>
                    <div className="flex gap-1">
                      {[25, 100, 500].map((amt) => (
                        <button
                          key={amt}
                          onClick={() => adjust(g, amt)}
                          className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-text hover:bg-bg"
                        >
                          +{amt}
                        </button>
                      ))}
                      <button
                        onClick={async () => {
                          const v = await promptDialog({
                            title: 'Adjust saved amount',
                            message: 'Enter an amount to add (use a negative number to subtract).',
                            defaultValue: '0',
                          });
                          if (v) adjust(g, Number(v));
                        }}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-border text-muted hover:text-text hover:bg-bg"
                      >
                        ±
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {adding ? (
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Goal name (e.g. Emergency fund)"
                className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text" autoFocus />
              <div className="grid grid-cols-2 gap-2">
                <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" placeholder="Target $"
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text" />
                <input value={current} onChange={(e) => setCurrent(e.target.value)} type="number" placeholder="Saved so far $"
                  className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text" />
              </div>
              <label className="block text-xs text-muted">Target date (optional)
                <input value={deadline} onChange={(e) => setDeadline(e.target.value)} type="date"
                  className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text" />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-surface">Cancel</button>
                <button onClick={create} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent/80">Add goal</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border text-sm text-muted hover:bg-surface hover:text-text"
            >
              <Plus size={14} /> New goal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
