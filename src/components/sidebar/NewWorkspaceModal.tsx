'use client';
import { useState } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import { IconPicker } from '@/components/icons/IconPicker';
import { EntityIcon } from '@/components/icons/registry';

// New-workspace dialog: name + a small library of icons to choose from.
export function NewWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || 'New workspace', icon }),
    });
    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New workspace</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md border border-border flex items-center justify-center shrink-0">
              <EntityIcon icon={icon} kind="workspace" size={18} />
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Workspace name"
              className="flex-1 px-3 py-2 rounded border border-border bg-bg text-sm"
            />
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Choose an icon</div>
            <IconPicker value={icon} onSelect={setIcon} onClear={() => setIcon(null)} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded border border-border text-sm">Cancel</button>
            <button
              onClick={create}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent text-white text-sm disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
