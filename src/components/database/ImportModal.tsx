'use client';

import { useMemo, useState } from 'react';
import { toast } from '@/components/ui/feedback';
import { parseImportText } from '@/lib/rowImport';

export type ToolDb = { id: string; properties: { id: string; name: string; type: string }[] };
type Default = { prop: string; value: string };

const field = 'bg-bg text-text border border-border rounded px-2 py-1 text-sm';
const ghost = 'px-3 py-1.5 bg-surface text-text border border-border rounded hover:bg-border text-sm';

async function postImport(dbId: string, rows: unknown, defaults: Default[]) {
  const res = await fetch(`/api/databases/${dbId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows,
      defaults: Object.fromEntries(defaults.filter((d) => d.prop && d.value).map((d) => [d.prop, d.value])),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Import failed');
  return data as { created: number; updated: number };
}

export function ImportModal({ database, onClose, onImported }: { database: ToolDb; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState('');
  const [defaults, setDefaults] = useState<Default[]>([]);
  const [busy, setBusy] = useState(false);

  const editable = database.properties.filter((p) => !['formula', 'relation', 'rollup'].includes(p.type));
  const parsed = useMemo(() => parseImportText(text, ['Name', editable[0]?.name ?? '']), [text, editable]);
  const known = new Set(editable.map((p) => p.name.toLowerCase()));
  const matched = parsed.columns.filter((c) => known.has(c.toLowerCase()));
  const skipped = parsed.columns.filter((c) => c && !known.has(c.toLowerCase()));
  const setDefault = (i: number, patch: Partial<Default>) => setDefaults(defaults.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await postImport(database.id, parsed.rows, defaults);
      toast.success(`Added ${r.created}, updated ${r.updated}`);
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-bg border border-border rounded-lg p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-text">Import rows</h2>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} className="text-sm text-text" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'Paste a CSV with a Name column, or one name per line.\nName, Phone / IG\nJordan H, @jordanh'}
          className={`w-full font-mono focus:outline-none focus:ring-1 focus:ring-accent ${field}`}
        />
        {parsed.rows.length > 0 && (
          <p className="text-sm text-text">
            {parsed.rows.length} rows found. Matched columns: {matched.join(', ') || 'none'}.
            {skipped.length > 0 && ` Skipped: ${skipped.join(', ')}.`} Names already in the database are updated, not duplicated.
          </p>
        )}
        <div className="space-y-1.5">
          <p className="text-sm text-text">Set on new rows</p>
          {defaults.map((d, i) => (
            <div key={i} className="flex gap-2">
              <select value={d.prop} onChange={(e) => setDefault(i, { prop: e.target.value })} className={field}>
                <option value="">Property</option>
                {editable.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
              <input value={d.value} onChange={(e) => setDefault(i, { value: e.target.value })} placeholder="value" className={`flex-1 ${field}`} />
            </div>
          ))}
          <button onClick={() => setDefaults([...defaults, { prop: '', value: '' }])} className="text-sm text-accent hover:underline">+ Add default</button>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={ghost}>Cancel</button>
          <button onClick={submit} disabled={busy || parsed.rows.length === 0} className="px-3 py-1.5 bg-accent text-white rounded text-sm disabled:opacity-50">
            {busy ? 'Importing...' : `Import ${parsed.rows.length || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
