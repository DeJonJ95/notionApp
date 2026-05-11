'use client';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function NewPageButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();

  const create = async () => {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    if (res.ok) {
      const page = await res.json();
      router.push(`/page/${page.id}`);
    }
  };

  return (
    <button
      onClick={create}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-surface text-sm"
    >
      <Plus size={14} /> New page
    </button>
  );
}
