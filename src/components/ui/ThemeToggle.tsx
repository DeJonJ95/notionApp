'use client';
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';

// Toggle order: System → Light → Dark → System.
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };

function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.remove('theme-light', 'theme-dark');
  if (t === 'light') el.classList.add('theme-light');
  else if (t === 'dark') el.classList.add('theme-dark');
  // 'system' leaves both classes off so the prefers-color-scheme media
  // query in globals.css takes over.
}

export function ThemeToggle() {
  // Initial render assumes 'system'; the real saved value loads in the
  // effect (localStorage isn't available during SSR). The no-FOUC script in
  // the root layout has already applied the correct class to <html>, so the
  // colors are right even before this hydrates — only the label catches up.
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('kove:theme') as Theme | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') setTheme(saved);
    } catch { /* private mode / SSR — ignore */ }
  }, []);

  const cycle = () => {
    const next = NEXT[theme];
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem('kove:theme', next); } catch { /* */ }
  };

  const label = theme === 'system' ? 'System theme' : theme === 'light' ? 'Light theme' : 'Dark theme';
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <button
      onClick={cycle}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg text-sm text-muted transition-colors"
      title={`${label} — click to switch`}
      aria-label={`Theme: ${label}. Click to switch.`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}
