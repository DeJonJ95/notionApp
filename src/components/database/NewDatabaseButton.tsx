'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface NewDatabaseButtonProps {
  workspaceId: string;
}

export function NewDatabaseButton({ workspaceId }: NewDatabaseButtonProps) {
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();

  const createDatabase = async () => {
    // Prompt before setting isCreating so the button isn't disabled
    // while the native dialog is open (which blocks the JS thread anyway).
    const name = prompt('Enter database name:');
    if (!name) return;

    setIsCreating(true);
    try {

      const res = await fetch('/api/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workspaceId }),
      });

      if (res.ok) {
        const db = await res.json();
        router.push(`/database/${db.id}`);
      }
    } catch (error) {
      console.error('Error creating database:', error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <button
      onClick={createDatabase}
      disabled={isCreating}
      className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
    >
      <Plus size={16} />
      {isCreating ? 'Creating...' : 'New Database'}
    </button>
  );
}