'use client';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  id: string;
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

// One box per dashboard section, folding down to its header. The header keeps
// its count and `right` content while folded, so the number that matters stays
// visible. Open or closed is remembered per section in localStorage.
export function Section({ id, title, icon, right, count, defaultOpen = true, children }: Props) {
  const storageKey = `kove-budget-section:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });

  const toggle = () =>
    setOpen((prev) => {
      try {
        window.localStorage.setItem(storageKey, prev ? '0' : '1');
      } catch {}
      return !prev;
    });

  return (
    <section className="rounded-xl border border-border bg-bg min-w-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={toggle} aria-expanded={open} className="flex flex-1 min-w-0 items-center gap-2 text-left">
          <ChevronRight size={16} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          {icon}
          <h2 className="text-base font-semibold truncate">{title}</h2>
          {typeof count === 'number' && <span className="text-sm text-muted shrink-0">{count}</span>}
        </button>
        {right}
      </div>
      {open && <div className="border-t border-border px-4 py-4">{children}</div>}
    </section>
  );
}
