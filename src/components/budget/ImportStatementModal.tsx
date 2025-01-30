'use client';
import { useState, useRef } from 'react';
import { Loader2, Upload, X, Check, AlertCircle, FileText } from 'lucide-react';

type Tx = {
  date: string;
  vendor: string;
  description: string;
  amount: number;
  category: string;
};

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export function ImportStatementModal({ onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [databaseName, setDatabaseName] = useState<string>('');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stage, setStage] = useState<'upload' | 'preview' | 'saving' | 'done'>('upload');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [truncated, setTruncated] = useState(false);

  const upload = async (file: File) => {
    setError('');
    setProgress(`Reading ${file.name}…`);
    setStage('upload');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/budget/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Import failed');
        return;
      }
      if (!json.transactions?.length) {
        setError('No transactions found in this file.');
        return;
      }
      setFilename(json.filename ?? file.name);
      setDatabaseId(json.databaseId);
      setDatabaseName(json.databaseName);
      setTxs(json.transactions);
      setCategories(json.categories);
      setTruncated(Boolean(json.truncated));
      setStage('preview');
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setProgress('');
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Vendors whose category the user manually changed in the preview — these
  // become persistent categorization rules on confirm so the correction
  // sticks for every future import.
  const learnedRef = useRef<Map<string, string>>(new Map());

  const updateTx = (i: number, patch: Partial<Tx>) => {
    setTxs((prev) =>
      prev.map((t, idx) => {
        if (idx !== i) return t;
        if (patch.category && patch.category !== t.category && t.vendor.trim()) {
          // Remember vendor (lowercased) → chosen category
          learnedRef.current.set(t.vendor.trim().toLowerCase(), patch.category);
        }
        return { ...t, ...patch };
      })
    );
  };

  const removeTx = (i: number) => {
    setTxs((prev) => prev.filter((_, idx) => idx !== i));
  };

  const confirm = async () => {
    if (!databaseId || txs.length === 0) return;
    setStage('saving');
    setError('');
    try {
      const res = await fetch('/api/budget/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, transactions: txs }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Save failed');
        setStage('preview');
        return;
      }
      // Persist learned categorization rules (fire-and-forget)
      for (const [match, category] of learnedRef.current.entries()) {
        fetch('/api/budget/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ match, category }),
        }).catch(() => {});
      }
      setStage('done');
      setTimeout(() => {
        onImported();
        onClose();
      }, 1200);
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
      setStage('preview');
    }
  };

  // Income & expense totals for the preview footer
  const totalIncome = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalExpense = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-bg border border-border rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <span className="font-semibold text-text flex items-center gap-2">
            <Upload size={16} className="text-accent" />
            Import bank statement
            {filename && <span className="text-muted text-xs font-normal ml-2">{filename}</span>}
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {stage === 'upload' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <FileText size={40} className="text-muted/40" />
              {progress ? (
                <>
                  <Loader2 size={18} className="animate-spin text-accent" />
                  <p className="text-sm text-muted">{progress}</p>
                  <p className="text-xs text-muted/70">DeepSeek is parsing &amp; categorizing — usually 5–15 seconds.</p>
                </>
              ) : (
                <>
                  <div className="text-center">
                    <p className="text-sm font-medium">Drop a CSV or PDF bank statement</p>
                    <p className="text-xs text-muted mt-1">
                      Works with Chase, BofA, Wells Fargo, Michigan First, and most others.
                    </p>
                  </div>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80"
                  >
                    Choose file
                  </button>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.pdf,.txt,text/csv,application/pdf,text/plain"
                className="hidden"
                onChange={onFile}
              />
            </div>
          )}

          {stage === 'preview' && txs.length > 0 && (
            <>
              <div className="mb-3 text-xs text-muted">
                Will save to <strong className="text-text">{databaseName}</strong>. Edit anything below, then confirm.
                Click the <X size={11} className="inline -mt-px" /> on a row to skip it.
              </div>
              {truncated && (
                <div className="mb-3 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-700 flex items-start gap-2">
                  <AlertCircle size={14} className="shrink-0 mt-px" />
                  <span>
                    The AI hit its output cap on one of the chunks — a few transactions near the end may have been
                    dropped. If totals look short, re-upload a smaller statement (or a single page).
                  </span>
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-xs text-muted">
                    <tr>
                      <th className="text-left px-2 py-2 font-medium">Date</th>
                      <th className="text-left px-2 py-2 font-medium">Vendor</th>
                      <th className="text-left px-2 py-2 font-medium">Category</th>
                      <th className="text-right px-2 py-2 font-medium">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {txs.map((t, i) => (
                      <tr key={i} className="border-t border-border/40 hover:bg-surface/40">
                        <td className="px-2 py-1.5">
                          <input
                            type="date"
                            value={t.date}
                            onChange={(e) => updateTx(i, { date: e.target.value })}
                            className="bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-accent rounded px-1 py-0.5 w-32"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={t.vendor}
                            onChange={(e) => updateTx(i, { vendor: e.target.value })}
                            className="bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-accent rounded px-1 py-0.5 w-full"
                            title={t.description}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={t.category}
                            onChange={(e) => updateTx(i, { category: e.target.value })}
                            className="bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-accent rounded px-1 py-0.5 border border-border/40"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono text-xs ${t.amount < 0 ? 'text-red-500' : 'text-green-600'}`}>
                          {t.amount < 0 ? '-' : '+'}${Math.abs(t.amount).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => removeTx(i)}
                            className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-500"
                            title="Skip this row"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {stage === 'saving' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={22} className="animate-spin text-accent" />
              <p className="text-sm">Saving {txs.length} transactions to {databaseName}…</p>
            </div>
          )}

          {stage === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-green-600">
              <Check size={28} />
              <p className="text-sm font-medium">Imported {txs.length} transactions</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'preview' && (
          <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0">
            <div className="text-xs text-muted">
              <span className="text-green-600">+${totalIncome.toFixed(2)}</span>
              <span className="mx-2">/</span>
              <span className="text-red-500">-${totalExpense.toFixed(2)}</span>
              <span className="ml-2">({txs.length} rows)</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={txs.length === 0}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              <Check size={14} /> Confirm &amp; import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
