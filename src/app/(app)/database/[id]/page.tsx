'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2, ChevronRight, FolderOutput } from 'lucide-react';
import { DatabaseView } from '@/components/database/DatabaseView';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

interface Database {
  id: string;
  name: string;
  workspaceId: string;
  workspace: Workspace;
  properties: Property[];
  views: View[];
  pages: Page[];
}

interface Property {
  id: string;
  name: string;
  type: string;
  formula?: string;
  position: number;
}

interface View {
  id: string;
  name: string;
  type: string;
  filters?: any;
  sorts?: any;
}

interface Page {
  id: string;
  title: string;
  icon?: string;
  properties: PropertyValue[];
}

interface PropertyValue {
  property: Property;
  value: any;
}

export default function DatabasePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [database, setDatabase] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchDatabase();
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : []))
      .then((w) => setWorkspaces(w))
      .catch(() => {});
  }, [params.id]);

  // Close move dropdown on outside click
  useEffect(() => {
    if (!moveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moveRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moveOpen]);

  const moveToWorkspace = async (workspaceId: string) => {
    if (!database || workspaceId === database.workspaceId) { setMoveOpen(false); return; }
    const res = await fetch(`/api/databases/${database.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    if (res.ok) {
      setMoveOpen(false);
      fetchDatabase();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'Failed to move database');
    }
  };

  const fetchDatabase = async () => {
    try {
      const res = await fetch(`/api/databases/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setDatabase(data);
      }
    } catch (error) {
      console.error('Error fetching database:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteDatabase = async () => {
    if (!database) return;
    if (!window.confirm(`Delete "${database.name}"? This will also delete all rows inside it and cannot be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/databases/${database.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push(`/workspace/${database.workspace.slug}`);
    } else {
      setDeleting(false);
    }
  };

  if (loading) return <div className="p-6 text-muted">Loading…</div>;
  if (!database) return <div className="p-6 text-muted">Database not found.</div>;

  return (
    <div className="p-4 md:p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted mb-3">
        <Link href={`/workspace/${database.workspace.slug}`} className="hover:text-text transition-colors">
          {database.workspace.icon && <span className="mr-1">{database.workspace.icon}</span>}
          {database.workspace.name}
        </Link>
        <ChevronRight size={12} />
        <span className="text-text">{database.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-text truncate">🗂️ {database.name}</h1>
        <div className="flex items-center gap-2 shrink-0">
          {/* Move to workspace */}
          <div className="relative" ref={moveRef}>
            <button
              onClick={() => setMoveOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted hover:text-text hover:bg-surface text-sm transition-colors"
              title="Move database to another workspace"
            >
              <FolderOutput size={14} />
              <span className="hidden sm:inline">Move</span>
            </button>
            {moveOpen && (
              <div className="absolute right-0 mt-1 w-60 rounded-lg border border-border bg-surface shadow-xl z-30 py-1 max-h-72 overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted">
                  Move to workspace
                </div>
                {workspaces.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted">No workspaces.</div>
                ) : (
                  workspaces.map((w) => {
                    const isCurrent = w.id === database.workspaceId;
                    return (
                      <button
                        key={w.id}
                        onClick={() => moveToWorkspace(w.id)}
                        disabled={isCurrent}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left ${
                          isCurrent ? 'text-muted/60 cursor-default' : 'text-text hover:bg-bg'
                        }`}
                      >
                        <span>{w.icon ?? '📁'}</span>
                        <span className="truncate flex-1">{w.name}</span>
                        {isCurrent && <span className="text-[10px] text-muted">current</span>}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <button
            onClick={deleteDatabase}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted hover:text-red-500 hover:border-red-400 text-sm transition-colors disabled:opacity-50"
            title="Delete database"
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete'}</span>
          </button>
        </div>
      </div>

      <DatabaseView database={database} onUpdate={fetchDatabase} />
    </div>
  );
}
