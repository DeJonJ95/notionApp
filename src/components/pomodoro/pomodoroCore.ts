export type Mode = 'work' | 'shortBreak' | 'longBreak';

export type Settings = {
  work: number;
  shortBreak: number;
  longBreak: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  sound: boolean;
};

export type TimerState = {
  mode: Mode;
  sessionCount: number;
  endsAt: number | null;
  pausedRemaining: number | null;
  label: string;
};

export type LogEntry = { endedAt: number; mode: Mode; minutes: number; label: string };

export const MODES: Mode[] = ['work', 'shortBreak', 'longBreak'];

export const MODE_LABELS: Record<Mode, string> = {
  work: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

export const DEFAULT_SETTINGS: Settings = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  sound: true,
};

export const INITIAL_STATE: TimerState = {
  mode: 'work',
  sessionCount: 0,
  endsAt: null,
  pausedRemaining: null,
  label: '',
};

export const KEYS = {
  settings: 'pomodoro-settings',
  state: 'pomodoro-state',
  log: 'pomodoro-log',
};

const LOG_LIMIT = 500;

export const durationSeconds = (mode: Mode, settings: Settings) => settings[mode] * 60;

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function timeLeftOf(state: TimerState, settings: Settings, now: number): number {
  if (state.endsAt != null) return Math.max(0, Math.round((state.endsAt - now) / 1000));
  return state.pausedRemaining ?? durationSeconds(state.mode, settings);
}

export function nextModeAfter(
  mode: Mode,
  sessionCount: number,
  settings: Settings,
): { mode: Mode; sessionCount: number } {
  if (mode !== 'work') return { mode: 'work', sessionCount };
  const count = sessionCount + 1;
  const mode2: Mode = count % settings.sessionsBeforeLongBreak === 0 ? 'longBreak' : 'shortBreak';
  return { mode: mode2, sessionCount: count };
}

export function advance(
  state: TimerState,
  settings: Settings,
  now: number,
): { state: TimerState; entry: LogEntry } {
  const next = nextModeAfter(state.mode, state.sessionCount, settings);
  const auto = state.mode === 'work' ? settings.autoStartBreaks : settings.autoStartFocus;
  const entry: LogEntry = { endedAt: now, mode: state.mode, minutes: settings[state.mode], label: state.label };
  return {
    state: {
      ...state,
      ...next,
      endsAt: auto ? now + durationSeconds(next.mode, settings) * 1000 : null,
      pausedRemaining: null,
    },
    entry,
  };
}

export function appendLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  return [...log, entry].slice(-LOG_LIMIT);
}

const sameLocalDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function todaySummary(log: LogEntry[], now: number) {
  const entries = log.filter((e) => e.mode === 'work' && sameLocalDay(e.endedAt, now));
  return {
    sessions: entries.length,
    minutes: entries.reduce((s, e) => s + e.minutes, 0),
    entries,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isMode = (v: unknown): v is Mode => typeof v === 'string' && (MODES as string[]).includes(v);

function minutes(v: unknown, fallback: number, max = 180): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.round(n));
}

export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw)) return null;
  const d = DEFAULT_SETTINGS;
  return {
    work: minutes(raw.work, d.work),
    shortBreak: minutes(raw.shortBreak, d.shortBreak),
    longBreak: minutes(raw.longBreak, d.longBreak),
    sessionsBeforeLongBreak: minutes(raw.sessionsBeforeLongBreak, d.sessionsBeforeLongBreak, 12),
    autoStartBreaks: typeof raw.autoStartBreaks === 'boolean' ? raw.autoStartBreaks : d.autoStartBreaks,
    autoStartFocus: typeof raw.autoStartFocus === 'boolean' ? raw.autoStartFocus : d.autoStartFocus,
    sound: typeof raw.sound === 'boolean' ? raw.sound : d.sound,
  };
}

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseState(raw: unknown): TimerState | null {
  if (!isRecord(raw) || !isMode(raw.mode)) return null;
  return {
    mode: raw.mode,
    sessionCount: numOrNull(raw.sessionCount) ?? 0,
    endsAt: numOrNull(raw.endsAt),
    pausedRemaining: numOrNull(raw.pausedRemaining),
    label: typeof raw.label === 'string' ? raw.label : '',
  };
}

export function parseLog(raw: unknown): LogEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LogEntry[] = [];
  for (const e of raw) {
    if (!isRecord(e) || !isMode(e.mode)) continue;
    const endedAt = numOrNull(e.endedAt);
    if (endedAt == null) continue;
    out.push({ endedAt, mode: e.mode, minutes: numOrNull(e.minutes) ?? 0, label: typeof e.label === 'string' ? e.label : '' });
  }
  return out;
}

export function loadJson<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? null : parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// The first version kept four separate keys; read them once so a timer that
// was running before this update keeps running after it.
export function migrateLegacyState(): TimerState | null {
  try {
    const mode = localStorage.getItem('pomodoro-mode');
    if (!isMode(mode)) return null;
    const num = (k: string) => {
      const v = localStorage.getItem(k);
      return v == null ? null : Number(v);
    };
    const state: TimerState = {
      mode,
      sessionCount: num('pomodoro-sessionCount') ?? 0,
      endsAt: num('pomodoro-endsAt'),
      pausedRemaining: num('pomodoro-pausedRemaining'),
      label: '',
    };
    ['pomodoro-mode', 'pomodoro-sessionCount', 'pomodoro-endsAt', 'pomodoro-pausedRemaining'].forEach((k) =>
      localStorage.removeItem(k),
    );
    return state;
  } catch {
    return null;
  }
}
