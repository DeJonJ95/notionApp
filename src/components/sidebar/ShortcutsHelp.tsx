'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Shortcut = { keys: string[]; label: string };

// Detect platform once so the modal can show the right modifier label.
// SSR-safe: the check runs only inside `Kbd` (client-only render path).
function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

// Render a single key as a styled <kbd>. "Mod" is replaced with ⌘ on
// Mac and "Ctrl" elsewhere so the same shortcut definitions work
// cross-platform without conditionals at the call site.
function Kbd({ k }: { k: string }) {
  const mac = isMac();
  const resolved = k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k;
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 bg-bg border border-border rounded text-[11px] font-mono text-text shadow-[0_1px_0_rgba(0,0,0,0.06)]">
      {resolved}
    </kbd>
  );
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Global',
    items: [
      { keys: ['Mod', 'K'], label: 'Open search' },
      { keys: ['Mod', 'P'], label: 'Quick switch (alias for search)' },
      { keys: ['Mod', '\\'], label: 'Toggle sidebar' },
      { keys: ['?'], label: 'Show this shortcuts list' },
    ],
  },
  {
    title: 'Inside a note',
    items: [
      { keys: ['/'], label: 'Open the block / slash menu' },
      { keys: ['Mod', 'B'], label: 'Bold' },
      { keys: ['Mod', 'I'], label: 'Italic' },
      { keys: ['Mod', 'U'], label: 'Underline' },
      { keys: ['Mod', 'Z'], label: 'Undo (per text block)' },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { keys: ['Tap empty area'], label: 'Add a text block where you tap' },
      { keys: ['Mod', 'Wheel'], label: 'Zoom in/out (anchors at cursor)' },
      { keys: ['1'], label: 'Zoom to 100% (centered on view)' },
      { keys: ['0'], label: 'Fit canvas to screen' },
      { keys: ['Alt', 'Drag block'], label: 'Move a block from anywhere' },
      { keys: ['Pinch'], label: 'Zoom on touch (mobile)' },
      { keys: ['Double-tap block'], label: 'Focus + zoom to that block (mobile)' },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  // Close on Escape — convenient and matches the rest of the app's modals.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] bg-black/40"
      onMouseDown={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col max-h-[80vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg text-muted hover:text-text transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 space-y-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-[10px] text-muted uppercase tracking-wide font-medium mb-2">
                {g.title}
              </p>
              <ul className="space-y-1.5">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-text">{s.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && <span className="text-muted text-xs">+</span>}
                          <Kbd k={k} />
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="px-5 py-2.5 border-t border-border text-[11px] text-muted text-center">
          Press <Kbd k="?" /> any time to open this list.
        </div>
      </div>
    </div>,
    document.body
  );
}
