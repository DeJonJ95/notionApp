'use client';
import { useState } from 'react';
import { X, Plus, Loader2, Check } from 'lucide-react';
import { DEFAULT_CATEGORIES, fallbackCategory } from '@/lib/budgetCategories';

// Manual entry for anything the statement import missed or hasn't covered yet.
// Posts to /api/budget/capture-tx, which already applies categorization rules
// and refuses duplicates — so a row added here behaves like an imported one.

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function AddTransactionModal({
  categories,
  accounts,
  onClose,
  onAdded,
}: {
  categories?: string[];
  accounts?: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const CATEGORIES = categories?.length ? categories : DEFAULT_CATEGORIES;
  const [date, setDate] = useState(today());
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState(fallbackCategory(CATEGORIES));
  const [account, setAccount] = useState(accounts?.[0] ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    if (!vendor.trim()) return setError('Who was it paid to, or from?');
    if (!Number.isFinite(value) || value === 0) return setError('Enter a non-zero amount.');

    setSaving(true);
    setError('');
    setDuplicate(false);
    try {
      const res = await fetch('/api/budget/capture-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.abs(value),
          type,
          vendor: vendor.trim(),
          date,
          category,
          account: account.trim(),
          note: note.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'Couldn’t save that transaction.');
        return;
      }
      if (json.duplicate) {
        // Written nothing on purpose — say so rather than implying success.
        setDuplicate(true);
        return;
      }
      setDone(true);
      onAdded();
      setTimeout(onClose, 900);
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Plus size={16} className="text-accent" /> Add transaction
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 text-xs px-3 py-2">{error}</div>
          )}
          {duplicate && (
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 text-yellow-700 text-xs px-3 py-2">
              A matching transaction is already in your budget within a few days of that date, so
              nothing was added.
            </div>
          )}
          {done ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-green-600">
              <Check size={26} />
              <p className="text-sm font-medium">Added</p>
            </div>
          ) : (
            <>
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(['expense', 'income'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`flex-1 py-2 text-sm capitalize transition-colors ${
                      type === t
                        ? t === 'income' ? 'bg-green-500/15 text-green-600 font-medium' : 'bg-red-500/15 text-red-500 font-medium'
                        : 'text-muted hover:bg-surface'
                    }`}
                  >
                    {t === 'income' ? 'Money in' : 'Money out'}
                  </button>
                ))}
              </div>

              <label className="block text-xs text-muted">
                {type === 'income' ? 'From' : 'To'}
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder={type === 'income' ? 'e.g. Apple Cash' : 'e.g. Shell'}
                  autoFocus
                  className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-muted">
                  Amount
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                  />
                </label>
                <label className="block text-xs text-muted">
                  Date
                  <input
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    type="date"
                    className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                  />
                </label>
              </div>

              <label className="block text-xs text-muted">
                Category
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <label className="block text-xs text-muted">
                Account <span className="opacity-70">(optional)</span>
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  list="known-accounts"
                  placeholder="Which account did this hit?"
                  className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                />
                <datalist id="known-accounts">
                  {(accounts ?? []).map((a) => <option key={a} value={a} />)}
                </datalist>
              </label>

              <label className="block text-xs text-muted">
                Note <span className="opacity-70">(optional)</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. the statement line as printed"
                  className="mt-0.5 w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                />
              </label>

              <p className="text-[11px] text-muted">
                Your categorization rules still apply, and an identical transaction within a few
                days won&apos;t be added twice.
              </p>
            </>
          )}
        </div>

        {!done && (
          <div className="flex items-center gap-2 px-5 py-3.5 border-t border-border shrink-0">
            <div className="flex-1" />
            <button onClick={onClose} className="px-3 py-2 rounded-lg border border-border text-xs hover:bg-surface">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/80 disabled:opacity-60"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? 'Saving…' : 'Add transaction'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
