import Link from 'next/link';
import { NotebookPen } from 'lucide-react';

// Home-screen shortcut to today's journal. Navigates to the dedicated
// /journal section which auto-creates/loads today's entry.
export function TodaysNoteButton() {
  return (
    <Link
      href="/journal"
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white font-medium shadow-sm hover:opacity-90 active:scale-[0.98] transition"
    >
      <NotebookPen size={18} />
      Open today&apos;s note
    </Link>
  );
}