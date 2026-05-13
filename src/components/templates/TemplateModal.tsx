'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronLeft } from 'lucide-react';
import { DB_TEMPLATES, type DbTemplate } from '@/lib/dbTemplates';

type Workspace = { id: string; name: string; slug: string; icon: string | null };

type Props = {
  onClose: () => void;
  onCreated?: () => void;
};

export function TemplateModal({ onClose, onCreated }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'pick' | 'configure'>('pick');
  const [selected, setSelected] = useState<DbTemplate | null>(null);
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        if (data.length > 0) setWorkspaceId(data[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step === 'configure') {
      setTimeout(() => nameRef.current?.focus(), 50);
    }
  }, [step]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function pick(template: DbTemplate) {
    setSelected(template);
    setName(template.name);
    setStep('configure');
  }

  async function create() {
    if (!selected || !workspaceId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/databases/from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selected.id,
          name: name.trim() || selected.name,
          workspaceId,
        }),
      });
      if (!res.ok) throw new Error('Failed to create database');
      const { databaseId } = await res.json();
      onCreated?.();
      onClose();
      router.push(`/database/${databaseId}`);
    } catch (err) {
      console.error(err);
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            {step === 'configure' && (
              <button
                onClick={() => setStep('pick')}
                className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
                aria-label="Back"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <h2 className="font-semibold text-sm">
              {step === 'pick' ? 'New database from template' : `Set up "${selected?.name}"`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step 1 — template grid */}
        {step === 'pick' && (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
            {DB_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t)}
                className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-accent hover:bg-bg text-left transition-colors group"
              >
                <span className="text-2xl leading-none mt-0.5">{t.icon}</span>
                <div className="min-w-0">
                  <div className="font-medium text-sm text-text group-hover:text-accent transition-colors">
                    {t.name}
                  </div>
                  <div className="text-xs text-muted mt-0.5 leading-snug">{t.description}</div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.properties.map((p) => (
                      <span
                        key={p.name}
                        className="text-[10px] bg-bg border border-border rounded px-1.5 py-0.5 text-muted"
                      >
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — configure */}
        {step === 'configure' && selected && (
          <div className="p-5 space-y-4">
            {/* Property preview */}
            <div className="rounded-lg border border-border bg-bg p-3">
              <p className="text-xs text-muted mb-2 font-medium uppercase tracking-wide">
                Included properties
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selected.properties.map((p) => (
                  <span
                    key={p.name}
                    className="flex items-center gap-1 text-xs bg-surface border border-border rounded px-2 py-1"
                  >
                    <span className="text-muted">
                      {p.type === 'select' ? '≡' : p.type === 'date' ? '📅' : p.type === 'number' ? '#' : p.type === 'checkbox' ? '☑' : 'T'}
                    </span>
                    {p.name}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted mt-2 font-medium uppercase tracking-wide">
                Views
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {selected.views.map((v) => (
                  <span
                    key={v.name}
                    className="text-xs bg-surface border border-border rounded px-2 py-1"
                  >
                    {v.name}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">
                Database name
              </label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                placeholder="Database name"
              />
            </div>

            {workspaces.length > 1 && (
              <div>
                <label className="block text-xs text-muted mb-1.5 font-medium uppercase tracking-wide">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.icon ? `${w.icon} ` : ''}{w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="pt-1 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-muted hover:bg-bg border border-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm bg-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity font-medium"
              >
                {creating ? 'Creating…' : 'Create database'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
