'use client';
import type { Settings } from './pomodoroCore';

const MINUTE_FIELDS: { key: 'work' | 'shortBreak' | 'longBreak'; label: string }[] = [
  { key: 'work', label: 'Focus' },
  { key: 'shortBreak', label: 'Short break' },
  { key: 'longBreak', label: 'Long break' },
];

const TOGGLES: { key: 'autoStartBreaks' | 'autoStartFocus' | 'sound'; label: string }[] = [
  { key: 'autoStartBreaks', label: 'Start breaks automatically' },
  { key: 'autoStartFocus', label: 'Start focus automatically' },
  { key: 'sound', label: 'Chime when a session ends' },
];

export function PomodoroSettings({
  settings, onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const setNumber = (key: keyof Settings, raw: string, max: number) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    onChange({ ...settings, [key]: Math.min(max, Math.max(1, n)) });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {MINUTE_FIELDS.map((f) => (
          <label key={f.key} className="text-[11px] text-muted">
            {f.label}
            <input
              type="number" min={1} max={180} value={settings[f.key]}
              onChange={(e) => setNumber(f.key, e.target.value, 180)}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
            />
            <span className="block text-[10px] opacity-70">minutes</span>
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between text-xs text-muted">
        Focus sessions before a long break
        <input
          type="number" min={1} max={12} value={settings.sessionsBeforeLongBreak}
          onChange={(e) => setNumber('sessionsBeforeLongBreak', e.target.value, 12)}
          className="w-14 rounded-md border border-border bg-bg px-2 py-1 text-sm text-text"
        />
      </label>
      {TOGGLES.map((t) => (
        <label key={t.key} className="flex items-center justify-between text-xs text-muted">
          {t.label}
          <input
            type="checkbox" checked={settings[t.key]}
            onChange={(e) => onChange({ ...settings, [t.key]: e.target.checked })}
            className="accent-[rgb(var(--accent))]"
          />
        </label>
      ))}
    </div>
  );
}
