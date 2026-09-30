'use client';

import { useState } from 'react';
import { ClipboardCopy, Upload } from 'lucide-react';
import { toast } from '@/components/ui/feedback';
import { ImportModal, type ToolDb } from './ImportModal';

type Row = { title: string; properties: { property: { name: string }; value: unknown }[] };

const CONTACT_PROPS = ['phone / ig', 'phone', 'contact', 'instagram', 'ig'];
const btn = 'flex items-center gap-1.5 px-3 py-1.5 bg-surface text-text border border-border rounded hover:bg-border transition-colors text-sm';

export function RowTools({ database, rows, onImported }: { database: ToolDb; rows: Row[]; onImported: () => void }) {
  const [open, setOpen] = useState(false);

  const copyList = async () => {
    const contact = database.properties.find((p) => CONTACT_PROPS.includes(p.name.trim().toLowerCase()));
    const lines = rows.map((r) => {
      const c = contact ? String(r.properties.find((pv) => pv.property.name === contact.name)?.value ?? '') : '';
      return c ? `${r.title} - ${c}` : r.title;
    });
    await navigator.clipboard.writeText(lines.join('\n'));
    toast.success(`Copied ${lines.length} ${lines.length === 1 ? 'person' : 'people'}`);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={btn} title="Import a CSV or paste a list of names">
        <Upload size={13} /> Import
      </button>
      <button onClick={copyList} className={btn} title="Copy the people in the current view, with contact info when there is one">
        <ClipboardCopy size={13} /> Copy list
      </button>
      {open && <ImportModal database={database} onClose={() => setOpen(false)} onImported={onImported} />}
    </>
  );
}
