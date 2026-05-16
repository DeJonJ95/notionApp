'use client';
import { useEffect, useState, useCallback } from 'react';
import { X, Plus, Trash2, Tag, Loader2 } from 'lucide-react';

type Rule = { id: string; match: string; category: string };

const CATEGORIES = [
  'Housing', 'Food & Dining', 'Transport', 'Utilities', 'Healthcare',
  'Insurance', 'Entertainment', 'Shopping', 'Education', 'Personal Care',
  'Subscriptions', 'Investments', 'Debt', 'Gifts & Donations',
  'Emergency Fund', 'Other',
];

export function CategorizationRulesModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [match, setMatch] = useState('');
  const [category, setCategory] = useState('Other');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch('/api/budget/rules')
      .then(async (r) => {
        const text = await r.text();
        let j: any = [];
        try { j = text ? JSON.parse(text) : []; } catch {}
        if (!r.ok) { setError(j?.error ?? `Failed (HTTP ${r.status})`); return []; }
        return Array.isArray(j) ? j : [];
      })
      .then(setRules)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!match.trim()) return;
    const res = await fetch('/api/budget/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match: match.trim(), category }),
    });
    if (res.ok) { setMatch(''); setCategory('Other'); load(); }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed'); }
  };

  const del = async (id: string) => {
    await fetch(`/api/budget/rules/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Tag size={16} className="text-accent" /> Categorization rules
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-muted">
            When an imported transaction&apos;s vendor contains the match text, its category is
            forced to your choice — overriding the AI. Rules are also created automatically
            whenever you correct a category during import.
          </p>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 text-xs px-3 py-2">{error}</div>
          )}

          {loading ? (
            <div className="text-center py-6"><Loader2 size={18} className="inline animate-spin text-accent" /></div>
          ) : rules.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">No rules yet.</p>
          ) : (
            <div className="space-y-1">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
                  <span className="font-mono text-xs text-muted truncate flex-1">“{r.match}”</span>
                  <span className="text-xs">→</span>
                  <span className="text-xs font-medium">{r.category}</span>
                  <button onClick={() => del(r.id)} className="text-muted hover:text-red-500 ml-1"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 flex flex-col gap-2">
            <div className="text-xs font-semibold text-accent uppercase tracking-wide">Add a rule</div>
            <input
              value={match}
              onChange={(e) => setMatch(e.target.value)}
              placeholder="If vendor contains… (e.g. shell, netflix)"
              className="w-full bg-bg border border-border rounded px-2 py-1 text-sm text-text"
            />
            <div className="flex gap-2">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex-1 bg-bg border border-border rounded px-2 py-1 text-sm text-text"
              >
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <button
                onClick={add}
                disabled={!match.trim()}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-accent text-white text-sm hover:bg-accent/80 disabled:opacity-40"
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
