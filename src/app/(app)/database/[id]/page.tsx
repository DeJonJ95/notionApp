'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trash2, ChevronRight } from 'lucide-react';
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

  useEffect(() => {
    fetchDatabase();
  }, [params.id]);

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
        <button
          onClick={deleteDatabase}
          disabled={deleting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted hover:text-red-500 hover:border-red-400 text-sm transition-colors disabled:opacity-50 shrink-0"
          title="Delete database"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">{deleting ? 'Deleting…' : 'Delete'}</span>
        </button>
      </div>

      <DatabaseView database={database} onUpdate={fetchDatabase} />
    </div>
  );
}
